import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { acquireDataLock } from '../storage/data-lock.mjs';
import { AssetStore } from '../storage/asset-store.mjs';
import { makeServer } from '../server.mjs';
import { createOpenAIProvider } from '../providers/openai-compatible.mjs';
import { AppError } from '../core/errors.mjs';
import { json, body, fields } from '../http/transport.mjs';
import { HubStore } from './store.mjs';
import { hubRoutes, publicRoute, ModelGateway } from './gateway.mjs';

const fail = (status, code, message) => {
  throw new AppError(status, code, message);
};
const assets = new Map([
  ['/hub', ['hub.html', 'text/html; charset=utf-8']],
  ['/hub.js', ['hub.js', 'text/javascript; charset=utf-8']],
  ['/hub.css', ['hub.css', 'text/css; charset=utf-8']],
  ['/model-preview.js', ['model-preview.js', 'text/javascript; charset=utf-8']],
]);
const vendors = new Map([
  ['/vendor/three.js', 'three/build/three.module.js'],
  ['/vendor/three.core.js', 'three/build/three.core.js'],
  ['/vendor/OrbitControls.js', 'three/examples/jsm/controls/OrbitControls.js'],
]);
const cookieToken = (req) =>
  req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('minemod_session='))
    ?.slice(16);
const bearer = (req) => req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

/** Optional self-hosted team service. The default CLI remains fully local. */
export async function makeHubServer({
  dataDir,
  publicOrigin = null,
  adminUsername,
  adminPassword,
  allowRegistration = false,
  providerRoutes = [],
  providerHosts = [],
  wechat = null,
  maxWorkspaces = 4,
} = {}) {
  if (publicOrigin) {
    const u = new URL(publicOrigin);
    if (
      u.origin !== publicOrigin ||
      u.username ||
      u.password ||
      !(
        u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
      )
    )
      fail(422, 'HUB_ORIGIN', '公共地址需要 HTTPS，且不包含路径；HTTP 只限本机。');
  }
  if (!Number.isInteger(maxWorkspaces) || maxWorkspaces < 1 || maxWorkspaces > 16)
    fail(422, 'HUB_LIMIT', '活跃工作台上限为 1–16。');
  const routes = hubRoutes(providerRoutes),
    release = acquireDataLock(dataDir);
  let store, shared;
  try {
    store = new HubStore(dataDir);
    shared = new AssetStore(join(dataDir, 'market-validation'));
    await store.bootstrap(adminUsername, adminPassword);
  } catch (error) {
    store?.close();
    release();
    throw error;
  }
  const gateway = new ModelGateway(store, routes),
    pool = new Map(),
    opening = new Map(),
    limits = new Map(),
    states = new Map();
  let stopping = false;
  const limited = (key, max, window = 60000) => {
    const now = Date.now();
    let r = limits.get(key);
    if (!r || r.until < now) {
      r = { n: 0, until: now + window };
      limits.set(key, r);
    }
    if (++r.n > max) fail(429, 'RATE_LIMIT', '请求频繁，请稍后再试。');
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  };
  function origin() {
    return publicOrigin ?? `http://127.0.0.1:${server.address().port}`;
  }
  function session(res, id) {
    const token = store.token(id);
    res.setHeader(
      'Set-Cookie',
      `minemod_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${origin().startsWith('https:') ? '; Secure' : ''}`,
    );
  }
  const requireUser = (user) => {
    if (!user) fail(401, 'LOGIN_REQUIRED', '请先登录。');
    return user;
  };
  const requireAdmin = (user) => {
    requireUser(user);
    if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED', '需要管理员。');
  };
  const selectedRoute = (user) =>
    routes.find((r) => r.id === store.preference(user.id, 'route')) ?? routes[0];
  async function workspace(user) {
    if (stopping) fail(503, 'HUB_STOPPING', '服务正在退出。');
    const existing = pool.get(user.id);
    if (existing) {
      if (existing.token && !store.authenticate(existing.token, ['workspace-model'])) {
        if (existing.server.isBusy || existing.requests)
          fail(409, 'HUB_BUSY', '请等待当前任务结束后刷新工作台。');
        pool.delete(user.id);
        await close(existing.server);
        return workspace(user);
      }
      existing.used = Date.now();
      return existing;
    }
    if (opening.has(user.id)) return opening.get(user.id);
    const promise = (async () => {
      if (pool.size + opening.size >= maxWorkspaces) {
        const idle = [...pool.entries()]
          .filter(([, v]) => !v.server.isBusy && v.requests === 0)
          .sort((a, b) => a[1].used - b[1].used)[0];
        if (!idle) fail(503, 'HUB_WORKSPACES_BUSY', '工作台正在执行任务，请稍后再试。');
        pool.delete(idle[0]);
        await close(idle[1].server);
        store.revoke(idle[1].token);
      }
      const route = selectedRoute(user),
        token = route
          ? store.token(user.id, 'workspace-model', '工作台内部线路', 7 * 86400000)
          : null;
      let provider = null;
      if (route) {
        provider = createOpenAIProvider({
          MINEMOD_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/api/hub/llm/${route.id}/v1`,
          MINEMOD_LLM_API_KEY: token,
          MINEMOD_LLM_MODEL: route.model,
        });
        provider.info = {
          ...provider.info,
          baseUrl: route.baseUrl,
          label: route.label,
          viaHub: true,
          routeId: route.id,
          price: publicRoute(route),
        };
      }
      const allowed = new Set([
        ...providerHosts,
        ...routes.map((r) => new URL(r.baseUrl).hostname),
      ]);
      const child = makeServer({
        dataDir: join(dataDir, 'users', user.id),
        llmProvider: provider,
        providerPolicy: (profile) => {
          if (user.role === 'admin') return;
          let u;
          try {
            u = new URL(profile.baseUrl);
          } catch {
            fail(422, 'HUB_PROVIDER_HOST', '模型基址无效。');
          }
          if (!allowed.has(u.hostname) || u.protocol !== 'https:')
            fail(
              403,
              'HUB_PROVIDER_HOST',
              '此托管服务仅允许管理员配置的 HTTPS 模型域名；本地版可使用自己的任意兼容接口。',
            );
        },
      });
      child.listen(0, '127.0.0.1');
      await once(child, 'listening');
      const entry = { server: child, token, used: Date.now(), requests: 0 };
      pool.set(user.id, entry);
      return entry;
    })();
    opening.set(user.id, promise);
    try {
      return await promise;
    } finally {
      opening.delete(user.id);
    }
  }
  async function proxy(req, res, user) {
    const target = await workspace(user);
    target.requests++;
    target.used = Date.now();
    await new Promise((resolve, reject) => {
      const headers = {
        ...req.headers,
        host: `127.0.0.1:${target.server.address().port}`,
        origin: `http://127.0.0.1:${target.server.address().port}`,
      };
      for (const name of [
        'cookie',
        'authorization',
        'forwarded',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-proto',
        'connection',
        'upgrade',
      ])
        delete headers[name];
      const upstream = httpRequest(
        {
          host: '127.0.0.1',
          port: target.server.address().port,
          path: req.url,
          method: req.method,
          headers,
        },
        (incoming) => {
          res.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(res);
          incoming.once('end', resolve);
          incoming.once('error', reject);
        },
      );
      upstream.once('error', reject);
      req.pipe(upstream);
      const abort = () => {
        if (!res.writableEnded) upstream.destroy();
      };
      res.once('close', abort);
      upstream.once('close', () => res.off('close', abort));
    }).finally(() => target.requests--);
  }
  const server = createServer(
    { requestTimeout: 30000, headersTimeout: 10000 },
    async (req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      try {
        const expected = new URL(origin()),
          internal = `127.0.0.1:${server.address().port}`,
          apiToken = bearer(req);
        if (req.headers.host !== expected.host && !(apiToken && req.headers.host === internal))
          fail(403, 'HOST_DENIED', '服务地址不符。');
        if (req.headers.origin && req.headers.origin !== expected.origin)
          fail(403, 'ORIGIN_DENIED', '不允许跨站请求。');
        if (
          !['GET', 'HEAD'].includes(req.method) &&
          !apiToken &&
          req.headers.origin !== expected.origin
        )
          fail(403, 'ORIGIN_REQUIRED', '写入请求需要同源 Origin。');
        const url = new URL(req.url, expected),
          path = url.pathname;
        const modelPath = path.match(/^\/api\/hub\/llm\/([a-z0-9_-]+)\/v1\/chat\/completions$/);
        const user = store.authenticate(
          apiToken ?? cookieToken(req),
          modelPath ? ['model', 'workspace-model', 'session'] : ['session'],
        );
        if (modelPath && req.method === 'POST') {
          requireUser(user);
          limited('model:' + user.id, 120);
          const route = routes.find((r) => r.id === modelPath[1]);
          if (!route) fail(404, 'HUB_ROUTE', '线路不存在。');
          const controller = new AbortController();
          res.once('close', () => {
            if (!res.writableEnded) controller.abort();
          });
          json(
            res,
            200,
            await gateway.complete(
              user,
              route,
              await body(req, 13 * 1024 * 1024),
              controller.signal,
            ),
          );
          return;
        }
        if (path === '/api/platform' && req.method === 'GET') {
          json(res, 200, {
            mode: 'hosted',
            authenticated: !!user,
            account: user,
            allowRegistration,
            routes: routes.map(publicRoute),
            selectedRoute: user ? selectedRoute(user)?.id : null,
            wechatConfigured: !!wechat?.appId,
          });
          return;
        }
        if (path === '/api/hub/login' && req.method === 'POST') {
          limited('login:' + req.socket.remoteAddress, 20, 900000);
          const i = fields(await body(req), ['username', 'password']);
          const account = await store.login(i.username, i.password);
          session(res, account.id);
          json(res, 200, { account });
          return;
        }
        if (path === '/api/hub/register' && req.method === 'POST') {
          limited('register:' + req.socket.remoteAddress, 10, 900000);
          const i = fields(await body(req), ['username', 'password', 'displayName', 'invite']);
          const account = await store.register(i, { allowRegistration });
          session(res, account.id);
          json(res, 201, { account });
          return;
        }
        if (path === '/api/hub/logout' && req.method === 'POST') {
          fields(await body(req), []);
          store.revoke(cookieToken(req));
          res.setHeader(
            'Set-Cookie',
            'minemod_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
          );
          json(res, 200, { loggedOut: true });
          return;
        }
        if (path === '/api/hub/wechat/start' && req.method === 'GET') {
          if (!wechat?.appId || !wechat?.appSecret)
            fail(409, 'WECHAT_NOT_CONFIGURED', '管理员尚未配置微信开放平台网站应用。');
          limited('wechat:' + req.socket.remoteAddress, 20);
          for (const [k, v] of states) if (v.until < Date.now()) states.delete(k);
          const state = randomBytes(24).toString('base64url'),
            browser = randomBytes(24).toString('base64url');
          states.set(state, {
            browser,
            until: Date.now() + 300000,
            invite: url.searchParams.get('invite') ?? null,
          });
          res.setHeader(
            'Set-Cookie',
            `minemod_wechat=${browser}; Path=/api/hub/wechat; HttpOnly; SameSite=Lax; Max-Age=300${expected.protocol === 'https:' ? '; Secure' : ''}`,
          );
          const target = new URL('https://open.weixin.qq.com/connect/qrconnect');
          target.search = new URLSearchParams({
            appid: wechat.appId,
            redirect_uri: origin() + '/api/hub/wechat/callback',
            response_type: 'code',
            scope: 'snsapi_login',
            state,
          }).toString();
          target.hash = 'wechat_redirect';
          json(res, 200, { url: target.href });
          return;
        }
        if (path === '/api/hub/wechat/callback' && req.method === 'GET') {
          const s = states.get(url.searchParams.get('state')),
            browser = req.headers.cookie
              ?.split(';')
              .map((v) => v.trim())
              .find((v) => v.startsWith('minemod_wechat='))
              ?.slice(15);
          states.delete(url.searchParams.get('state'));
          if (!s || s.until < Date.now() || browser !== s.browser)
            fail(403, 'WECHAT_STATE', '微信登录已过期，请重新扫码。');
          const code = url.searchParams.get('code');
          if (!code || code.length > 500) fail(400, 'WECHAT_CODE', '微信授权码无效。');
          const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
          tokenUrl.search = new URLSearchParams({
            appid: wechat.appId,
            secret: wechat.appSecret,
            code,
            grant_type: 'authorization_code',
          }).toString();
          const response = await fetch(tokenUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          const data = await response.json();
          if (!response.ok || data.errcode || typeof data.openid !== 'string')
            fail(502, 'WECHAT_PROVIDER', '微信授权失败，请重试。');
          const account = store.linkWechat(data.openid, null, s.invite, { allowRegistration });
          session(res, account.id);
          res.writeHead(303, { Location: '/' });
          res.end();
          return;
        }
        if (path === '/api/hub/market' && req.method === 'GET') {
          json(res, 200, {
            listings: store.market(user, {
              q: url.searchParams.get('q') ?? '',
              mine: url.searchParams.get('mine') === 'true',
              pending: url.searchParams.get('pending') === 'true',
              favorites: url.searchParams.get('favorites') === 'true',
              offset: Number(url.searchParams.get('offset') ?? 0),
            }),
          });
          return;
        }
        const listingPath = path.match(
          /^\/api\/hub\/market\/([a-f0-9-]{36})(?:\/(package|favorite|import|review|unpublish))?$/,
        );
        if (listingPath && req.method === 'GET') {
          const listing = store.listing(listingPath[1], user);
          if (listingPath[2] === 'package') {
            res.setHeader('Content-Disposition', 'attachment; filename="model-assets.json"');
            json(res, 200, listing.payload);
          } else if (!listingPath[2]) {
            const { payload, ...metadata } = listing;
            json(res, 200, metadata);
          } else fail(404, 'NOT_FOUND', '接口不存在。');
          return;
        }
        if (req.method === 'GET' && vendors.has(path)) {
          const raw = await readFile(
            new URL('../../node_modules/' + vendors.get(path), import.meta.url),
            'utf8',
          );
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          res.end(raw.replaceAll("from 'three'", "from '/vendor/three.js'"));
          return;
        }
        if (assets.has(path) || (path === '/' && !user)) {
          if (req.method !== 'GET') fail(405, 'METHOD', '仅支持 GET。');
          const [file, type] = assets.get(path) ?? assets.get('/hub');
          res.writeHead(200, { 'Content-Type': type });
          res.end(await readFile(new URL('../../web/' + file, import.meta.url)));
          return;
        }
        requireUser(user);
        if (path.startsWith('/api/hub/')) limited('account:' + user.id, 240);
        if (path === '/api/hub/account' && req.method === 'GET') {
          json(res, 200, {
            account: store.account(user.id),
            ledger: store.ledger(user.id),
            incentives: store.incentives(user),
          });
          return;
        }
        if (path === '/api/hub/password' && req.method === 'POST') {
          const i = fields(await body(req), ['oldPassword', 'newPassword']);
          await store.changePassword(user.id, i.oldPassword, i.newPassword);
          const entry = pool.get(user.id);
          if (entry && !entry.server.isBusy && !entry.requests) {
            pool.delete(user.id);
            await close(entry.server);
          }
          session(res, user.id);
          json(res, 200, { changed: true });
          return;
        }
        if (path === '/api/hub/invites' && req.method === 'POST') {
          fields(await body(req), []);
          requireAdmin(user);
          json(res, 201, { invite: store.invite(user.id), expiresInDays: 7 });
          return;
        }
        if (path === '/api/hub/checkin' && req.method === 'POST') {
          fields(await body(req), []);
          json(res, 200, store.checkin(user.id));
          return;
        }
        if (path === '/api/hub/incentives' && req.method === 'POST') {
          json(res, 201, store.submitIncentive(user.id, fields(await body(req), ['url', 'title'])));
          return;
        }
        const incentivePath = path.match(/^\/api\/hub\/incentives\/([a-f0-9-]{36})\/review$/);
        if (incentivePath && req.method === 'POST') {
          requireAdmin(user);
          json(
            res,
            200,
            store.reviewIncentive(
              user,
              incentivePath[1],
              fields(await body(req), ['approve', 'reward', 'reason']),
            ),
          );
          return;
        }
        if (path === '/api/hub/tokens' && req.method === 'POST') {
          const i = fields(await body(req), ['label']);
          if (typeof i.label !== 'string' || !i.label.trim() || i.label.length > 80)
            fail(422, 'TOKEN_LABEL', '请填写 1–80 字用途。');
          json(res, 201, {
            token: store.token(user.id, 'model', i.label, 30 * 86400000),
            expiresInDays: 30,
            scope: 'model',
          });
          return;
        }
        if (path === '/api/hub/tokens' && req.method === 'DELETE') {
          const i = fields(await body(req), ['token']);
          if (store.authenticate(i.token, ['model'])?.id !== user.id)
            fail(404, 'TOKEN_NOT_FOUND', '令牌不存在。');
          store.revoke(i.token);
          json(res, 200, { revoked: true });
          return;
        }
        if (path === '/api/hub/route' && req.method === 'POST') {
          const i = fields(await body(req), ['routeId']);
          if (!routes.some((r) => r.id === i.routeId)) fail(404, 'HUB_ROUTE', '线路不存在。');
          const entry = pool.get(user.id);
          if (entry && (entry.server.isBusy || entry.requests))
            fail(409, 'HUB_BUSY', '请先等待当前任务结束。');
          if (entry) {
            pool.delete(user.id);
            await close(entry.server);
            store.revoke(entry.token);
          }
          store.preference(user.id, 'route', i.routeId);
          json(res, 200, { routeId: i.routeId });
          return;
        }
        if (path === '/api/hub/market' && req.method === 'POST') {
          limited('publish:' + user.id, 20);
          const i = fields(await body(req, 32 * 1024 * 1024), [
            'id',
            'revision',
            'title',
            'description',
            'tags',
            'license',
            'rightsConfirmed',
            'assetIds',
            'package',
          ]);
          let pack = i.package;
          if (!pack) {
            const w = await workspace(user);
            if (!Array.isArray(i.assetIds) || !i.assetIds.length || i.assetIds.length > 30)
              fail(422, 'MARKET_ASSETS', '选择 1–30 个自己的素材。');
            pack = w.server.workshop.assets.exportPackage(i.assetIds);
          }
          // Validate without adding copies to the shared/private asset store.
          const { checksum, ...payload } = pack ?? {};
          const { sha256 } = await import('../core/archive.mjs');
          if (
            payload.format !== 'minemod-assets' ||
            payload.version !== 1 ||
            !Array.isArray(payload.assets) ||
            !payload.assets.length ||
            payload.assets.length > 30 ||
            checksum !== sha256(JSON.stringify(payload))
          )
            fail(422, 'MARKET_PACKAGE', '资源包格式或校验失败。');
          for (const asset of payload.assets) shared.prepare(asset);
          json(res, 201, store.publish(user, i, pack));
          return;
        }
        if (listingPath && req.method === 'POST') {
          const id = listingPath[1],
            operation = listingPath[2];
          if (operation === 'review') {
            requireAdmin(user);
            json(
              res,
              200,
              store.reviewListing(
                user,
                id,
                fields(await body(req), ['revision', 'approve', 'reason']),
              ),
            );
          } else if (operation === 'favorite') {
            const i = fields(await body(req), ['favorite']);
            json(res, 200, store.favorite(user, id, i.favorite));
          } else if (operation === 'unpublish') {
            fields(await body(req), []);
            json(res, 200, store.unpublish(user, id));
          } else if (operation === 'import') {
            fields(await body(req), []);
            const listing = store.listing(id, user),
              w = await workspace(user);
            json(res, 201, {
              assets: w.server.workshop.assets.importPackage(listing.payload),
              listingId: id,
              revision: listing.revision,
            });
          } else fail(404, 'NOT_FOUND', '接口不存在。');
          return;
        }
        if (path.startsWith('/api/hub/')) fail(404, 'NOT_FOUND', '托管接口不存在。');
        limited('workspace:' + user.id, 600);
        await proxy(req, res, user);
      } catch (error) {
        if (!res.headersSent && !res.destroyed)
          json(res, error instanceof AppError ? error.status : 500, {
            error: {
              code: error instanceof AppError ? error.code : 'HUB_ERROR',
              message: error instanceof AppError ? error.message : '托管服务发生错误。',
            },
          });
        else res.destroy();
      }
    },
  );
  const nativeClose = server.close.bind(server);
  let closing;
  server.close = (callback) => {
    if (!closing) {
      stopping = true;
      gateway.close();
      closing = (async () => {
        await Promise.allSettled(opening.values());
        await Promise.allSettled(
          [...pool.values()].map(async (v) => {
            await close(v.server);
            store.revoke(v.token);
          }),
        );
        if (server.listening)
          await new Promise((resolve, reject) => nativeClose((e) => (e ? reject(e) : resolve())));
      })().finally(() => {
        store.close();
        release();
      });
    }
    if (callback) void closing.then(() => callback(), callback);
    return server;
  };
  server.hub = { store, pool, gateway };
  return server;
}
