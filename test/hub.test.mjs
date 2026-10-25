import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { HubStore } from '../src/hub/store.mjs';
import { makeHubServer } from '../src/hub/server.mjs';
import { AssetStore } from '../src/storage/asset-store.mjs';
import { ProviderProfileStore } from '../src/storage/provider-profile-store.mjs';
import { makeServer } from '../src/server.mjs';
import { AppError } from '../src/core/errors.mjs';

const credentials = { username: 'admin', password: 'correct horse battery staple' };
const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
const teardown = new Map();
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-hub-'));
  teardown.set(dir, []);
  t.after(async () => {
    for (const fn of teardown.get(dir).reverse()) await fn();
    teardown.delete(dir);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};
test('a revoked hosted provider remains editable without starting model requests or trapping the workspace lock', async (t) => {
  const dir = temp(t),
    profiles = new ProviderProfileStore(dir),
    saved = profiles.save(
      {
        name: '曾允许的服务',
        kind: 'text',
        baseUrl: 'https://provider.invalid/v1',
        model: 'fixture',
        apiKey: 'private-fixture-key',
      },
      0,
    );
  profiles.activate('text', saved.profiles[0].id, saved.revision);
  const server = makeServer({
    dataDir: dir,
    providerPolicy: () => {
      throw new AppError(403, 'HUB_PROVIDER_HOST', '管理员已撤销域名。');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  teardown.get(dir).push(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const info = await (await fetch(base + '/api/providers')).json();
  assert.equal(info.providers[1].configured, false);
  assert.match(info.providers[1].configurationError, /撤销/);
  assert.equal(JSON.stringify(info).includes('private-fixture-key'), false);
  const settings = await (await fetch(base + '/api/settings/providers')).json();
  const disabled = await fetch(base + '/api/settings/providers/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: settings.revision, kind: 'text', profileId: null }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).active.text, null);
});
test('hosted transactions: invites, passwords, one daily reward, moderation and interrupted usage refunds', async (t) => {
  const dir = temp(t),
    store = new HubStore(dir);
  teardown.get(dir).push(() => store.close());
  await store.bootstrap(credentials.username, credentials.password);
  const admin = await store.login(credentials.username, credentials.password);
  assert.equal(admin.credits, 1000);
  assert.equal(admin.password_hash, undefined);
  const invite = store.invite(admin.id);
  const member = await store.register({
    username: 'creator',
    password: 'my secret password',
    invite,
  });
  assert.equal(member.credits, 1000);
  await assert.rejects(
    store.register({ username: 'creator2', password: 'my secret password', invite }),
    { code: 'INVITE_REQUIRED' },
  );
  await assert.rejects(store.login('creator', 'wrong password'), { code: 'LOGIN_FAILED' });
  const token = store.token(member.id, 'model', 'external');
  assert.equal(store.authenticate(token, ['model']).id, member.id);
  assert.equal(store.authenticate(token), null);
  assert.equal(store.checkin(member.id).account.credits, 1010);
  assert.equal(store.checkin(member.id).alreadyChecked, true);
  const incentive = store.submitIncentive(member.id, {
    title: '原创制作视频',
    url: 'https://www.bilibili.com/video/BV123',
  });
  store.reviewIncentive(admin, incentive.id, { approve: true, reward: 50 });
  assert.throws(() => store.reviewIncentive(admin, incentive.id, { approve: true }), {
    code: 'ALREADY_REVIEWED',
  });
  const reservation = store.reserve(member.id, 'paid', 100);
  assert.equal(store.account(member.id).credits, 960);
  assert.equal(store.settle(reservation, 30, { inputTokens: 20, outputTokens: 10 }).balance, 1030);
  assert.equal(store.settle(reservation, 30, {}), null);
  store.reserve(member.id, 'interrupted', 60);
  store.close();
  const restored = new HubStore(dir);
  teardown.get(dir).push(() => restored.close());
  assert.equal(restored.account(member.id).credits, 1030);
  await restored.changePassword(member.id, 'my secret password', 'changed secure password');
  assert.equal(restored.authenticate(token, ['model']), null);
  await assert.rejects(restored.login('creator', 'my secret password'));
  assert.ok((await restored.login('creator', 'changed secure password')).id);
  restored.close();
  assert.equal(readFileSync(join(dir, 'hub.sqlite')).includes(Buffer.from(token)), false);
});

test('hosted HTTP isolates devices/accounts, publishes immutable reviewed assets, and bills real protocol usage', async (t) => {
  const dir = temp(t);
  let upstreamCalls = 0,
    fail = false,
    unknown = false;
  const upstream = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const input = JSON.parse(raw);
    assert.equal(input.model, 'fixture-model');
    upstreamCalls++;
    res.writeHead(fail ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '{"fixture":true}' } }],
        ...(!unknown ? { usage: { prompt_tokens: 4, completion_tokens: 6 } } : {}),
      }),
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  teardown.get(dir).push(() => close(upstream));
  const server = await makeHubServer({
    dataDir: dir,
    adminUsername: credentials.username,
    adminPassword: credentials.password,
    maxWorkspaces: 2,
    providerRoutes: [
      {
        id: 'paid',
        baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
        model: 'fixture-model',
        inputCreditsPer1000: 1000,
        outputCreditsPer1000: 1000,
      },
    ],
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  teardown.get(dir).push(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = 'GET', data, cookie, extra = {}) {
    return fetch(base + path, {
      method,
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  }
  const login = await call('/api/hub/login', 'POST', credentials);
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const invite = (await (await call('/api/hub/invites', 'POST', {}, cookie)).json()).invite;
  const registered = await call('/api/hub/register', 'POST', {
    username: 'maker',
    password: 'member secret password',
    invite,
  });
  assert.equal(registered.status, 201, await registered.clone().text());
  const memberCookie = registered.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/projects', 'GET', null, null)).status, 401);
  assert.equal(
    (await call('/api/hub/checkin', 'POST', {}, cookie, { Origin: 'https://evil.example' })).status,
    403,
  );
  const created = await call(
    '/api/projects',
    'POST',
    { name: '跨设备创作', prompt: '一个水晶' },
    memberCookie,
  );
  assert.equal(created.status, 201, await created.clone().text());
  const project = await created.json();
  const otherDevice = await call('/api/hub/login', 'POST', {
    username: 'maker',
    password: 'member secret password',
  });
  const secondCookie = otherDevice.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await (await call('/api/projects/' + project.id, 'GET', null, secondCookie)).json()).name,
    '跨设备创作',
  );
  assert.equal((await call('/api/projects/' + project.id, 'GET', null, cookie)).status, 404);
  const privateProfile = await call(
    '/api/settings/providers',
    'POST',
    {
      revision: 0,
      name: 'private',
      kind: 'text',
      baseUrl: 'https://169.254.169.254/v1',
      model: 'fixture',
      apiKey: 'do-not-send',
    },
    memberCookie,
  );
  assert.equal(privateProfile.status, 403);
  const authorAssets = new AssetStore(join(dir, 'test-assets'));
  const asset = authorAssets.create({
      name: '模型 % 测试',
      kind: 'model',
      data: { elements: [{ from: [0, 0, 0], to: [8, 8, 8] }] },
      source: 'original-test',
      license: 'CC0-1.0',
    }),
    pack = authorAssets.exportPackage([asset.id]);
  const submitted = await call(
    '/api/hub/market',
    'POST',
    {
      title: '模型 % 测试',
      description: '原创模型',
      license: 'CC0-1.0',
      tags: ['cube'],
      rightsConfirmed: true,
      package: pack,
    },
    memberCookie,
  );
  assert.equal(submitted.status, 201, await submitted.clone().text());
  const listing = await submitted.json();
  assert.equal((await (await call('/api/hub/market')).json()).listings.length, 0);
  assert.equal((await call(`/api/hub/market/${listing.id}/package`)).status, 404);
  assert.equal(
    (
      await call(
        `/api/hub/market/${listing.id}/review`,
        'POST',
        { revision: 1, approve: true },
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/api/hub/market/${listing.id}/review`,
        'POST',
        { revision: 1, approve: true },
        cookie,
      )
    ).status,
    200,
  );
  const search = await call('/api/hub/market?q=%25');
  assert.equal(search.status, 200, await search.clone().text());
  assert.equal((await search.json()).listings.length, 1);
  const imported = await call(`/api/hub/market/${listing.id}/import`, 'POST', {}, cookie);
  assert.equal(imported.status, 201, await imported.clone().text());
  assert.equal((await imported.json()).assets[0].sha256, asset.sha256);
  await call(
    '/api/hub/market',
    'POST',
    {
      id: listing.id,
      revision: 1,
      title: '新版等待审核',
      description: '修改',
      license: 'CC0-1.0',
      tags: [],
      rightsConfirmed: true,
      package: pack,
    },
    memberCookie,
  );
  assert.equal((await (await call('/api/hub/market')).json()).listings[0].title, '模型 % 测试');
  const modelToken = (
    await (await call('/api/hub/tokens', 'POST', { label: '外部测试' }, memberCookie)).json()
  ).token;
  const headers = { Authorization: 'Bearer ' + modelToken };
  const request = {
    model: 'fixture-model',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 20,
  };
  const usage = await call('/api/hub/llm/paid/v1/chat/completions', 'POST', request, null, headers);
  assert.equal(usage.status, 200, await usage.clone().text());
  assert.equal((await usage.json()).minemodBilling.billed, 10);
  assert.equal(
    (await (await call('/api/hub/account', 'GET', null, memberCookie)).json()).account.credits,
    990,
  );
  fail = true;
  assert.equal(
    (await call('/api/hub/llm/paid/v1/chat/completions', 'POST', request, null, headers)).status,
    502,
  );
  fail = false;
  unknown = true;
  assert.equal(
    (
      await (
        await call('/api/hub/llm/paid/v1/chat/completions', 'POST', request, null, headers)
      ).json()
    ).minemodBilling.usageKnown,
    false,
  );
  assert.equal(
    (await (await call('/api/hub/account', 'GET', null, memberCookie)).json()).account.credits,
    990,
  );
  assert.equal(upstreamCalls, 3);
  const externalImage = await call(
    '/api/hub/llm/paid/v1/chat/completions',
    'POST',
    {
      ...request,
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://private.invalid/image.png' } }],
        },
      ],
    },
    null,
    headers,
  );
  assert.equal(externalImage.status, 422);
  assert.equal(upstreamCalls, 3);

  assert.equal((await call('/api/projects', 'GET', null, null, headers)).status, 401);
  const logout = await call('/api/hub/logout', 'POST', {}, secondCookie);
  assert.equal(logout.status, 200);
  assert.equal((await call('/api/projects', 'GET', null, secondCookie)).status, 401);
  assert.equal((await call('/api/projects', 'GET', null, memberCookie)).status, 200);
});

test('WeChat protocol binds one-time state to the browser and awards a new invited identity only once', async (t) => {
  const dir = temp(t),
    server = await makeHubServer({
      dataDir: dir,
      adminUsername: credentials.username,
      adminPassword: credentials.password,
      wechat: { appId: 'protocol-fixture-app', appSecret: 'protocol-fixture-secret' },
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  teardown.get(dir).push(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`,
    admin = await server.hub.store.login(credentials.username, credentials.password),
    invite = server.hub.store.invite(admin.id);
  const realFetch = globalThis.fetch;
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.hostname === 'api.weixin.qq.com') {
      assert.equal(target.pathname, '/sns/oauth2/access_token');
      assert.equal(target.searchParams.get('secret'), 'protocol-fixture-secret');
      exchanges++;
      return new Response(JSON.stringify({ openid: 'invited-fixture-openid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(url, options);
  });
  async function start() {
    const r = await fetch(base + '/api/hub/wechat/start?invite=' + invite);
    assert.equal(r.status, 200);
    const target = new URL((await r.json()).url);
    assert.equal(target.hostname, 'open.weixin.qq.com');
    assert.equal(target.searchParams.get('redirect_uri'), base + '/api/hub/wechat/callback');
    return {
      state: target.searchParams.get('state'),
      cookie: r.headers.get('set-cookie').split(';')[0],
    };
  }
  const wrong = await start();
  assert.equal(
    (
      await fetch(base + '/api/hub/wechat/callback?code=fixture&state=' + wrong.state, {
        redirect: 'manual',
      })
    ).status,
    403,
  );
  assert.equal(exchanges, 0);
  const correct = await start();
  const callback = base + '/api/hub/wechat/callback?code=fixture&state=' + correct.state;
  const accepted = await fetch(callback, {
    headers: { Cookie: correct.cookie },
    redirect: 'manual',
  });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get('location'), '/');
  const session = accepted.headers.get('set-cookie').split(';')[0];
  const account = (
    await (await fetch(base + '/api/hub/account', { headers: { Cookie: session } })).json()
  ).account;
  assert.equal(account.credits, 1000);
  assert.equal(account.wechatLinked, true);
  assert.equal(JSON.stringify(account).includes('openid'), false);
  assert.equal(
    (await fetch(callback, { headers: { Cookie: correct.cookie }, redirect: 'manual' })).status,
    403,
  );
  const again = await start();
  const repeated = await fetch(
    base + '/api/hub/wechat/callback?code=another-fixture&state=' + again.state,
    { headers: { Cookie: again.cookie }, redirect: 'manual' },
  );
  assert.equal(repeated.status, 303);
  assert.equal(server.hub.store.account(account.id).credits, 1000);
  assert.equal(exchanges, 2);
});
