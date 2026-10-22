import { acquireDataLock } from './storage/data-lock.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from './storage/project-store.mjs';
import { mockProvider } from './providers/mock.mjs';
import { capabilities } from './core/capabilities.mjs';
import { AppError } from './core/errors.mjs';
import { modSpecSchema } from './core/mod-spec.mjs';
import { vanillaItems } from './core/registries.mjs';
import { TARGET } from './core/project.mjs';
import { TARGETS, getTarget } from './core/targets.ts';
import { workshopServices } from './workshop-routes.mjs';
import fullExample from '../examples/full-workshop.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };

const VENDORS = new Map([
  ['/vendor/three.js', 'three/build/three.module.js'],
  ['/vendor/three.core.js', 'three/build/three.core.js'],
  ['/vendor/OrbitControls.js', 'three/examples/jsm/controls/OrbitControls.js'],
]);

const MAX_BODY = 24 * 1024;
const ASSETS = new Map([
  ['/studio/animation-editor.js', ['studio/animation-editor.js', 'text/javascript; charset=utf-8']],
  [
    '/studio/animation-timeline.js',
    ['studio/animation-timeline.js', 'text/javascript; charset=utf-8'],
  ],
  ['/studio/entity-editor.js', ['studio/entity-editor.js', 'text/javascript; charset=utf-8']],
  ['/studio/image-studio.js', ['studio/image-studio.js', 'text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/workshop.js', ['workshop.js', 'text/javascript; charset=utf-8']],
  ['/studio/project-hub.js', ['studio/project-hub.js', 'text/javascript; charset=utf-8']],
  ['/studio/model-editor.js', ['studio/model-editor.js', 'text/javascript; charset=utf-8']],
  ['/model-preview.js', ['model-preview.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function fields(input, allowed) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    throw new AppError(400, 'INVALID_INPUT', '请求字段不正确。');
  }
  return input;
}

function publicProject({ specHistory, ...project }) {
  return { ...project, historyCount: specHistory.length };
}

async function body(request, limit = MAX_BODY) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', '请求必须使用 application/json。');
  }
  if (Number(request.headers['content-length']) > limit)
    throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'JSON 格式不正确。');
  }
}

export function makeServer({ dataDir, llmProvider = null, imageProvider = null }) {
  const releaseLock = acquireDataLock(dataDir);
  let store, workshop;
  try {
    store = new ProjectStore(dataDir);
    workshop = workshopServices(dataDir, store);
  } catch (error) {
    releaseLock();
    throw error;
  }
  const active = new Map();

  function requireConsent(input) {
    if (!llmProvider?.info.configured)
      throw new AppError(
        409,
        'PROVIDER_NOT_CONFIGURED',
        '请先在服务端 .env 中配置 LLM 基址、模型和密钥，然后重启服务。',
      );
    if (input.consent !== llmProvider.info.configurationId)
      throw new AppError(400, 'CONSENT_REQUIRED', '请先核对当前服务商、模型和发送内容并明确确认。');
  }
  async function callModel(key, project, response, method = 'planSpec') {
    if (active.has(key))
      throw new AppError(409, 'PLANNING_ACTIVE', '该项目已有模型请求，请等待或取消。');
    if (active.size >= 2)
      throw new AppError(429, 'PLANNING_LIMIT', '最多同时运行两个模型请求，请稍后再试。');
    const controller = new AbortController();
    active.set(key, controller);
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', disconnect);
    try {
      return await llmProvider[method](project, { signal: controller.signal });
    } finally {
      active.delete(key);
      response.off('close', disconnect);
    }
  }
  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    async (request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      response.setHeader('Referrer-Policy', 'no-referrer');
      try {
        const port = request.socket.localPort;
        const origin = `http://127.0.0.1:${port}`;
        // Restrict Host as well as Origin to resist DNS rebinding and cross-site writes.
        if (request.headers.host !== `127.0.0.1:${port}`)
          throw new AppError(403, 'HOST_DENIED', '请使用本机 127.0.0.1 地址。');
        if (request.headers.origin && request.headers.origin !== origin)
          throw new AppError(403, 'ORIGIN_DENIED', '不允许跨站请求。');
        const url = new URL(request.url, origin);
        const pathname = url.pathname;
        if (await workshop.route({ request, response, url, json, body, fields, publicProject }))
          return;
        if (request.method === 'GET' && VENDORS.has(pathname)) {
          const raw = await readFile(
            fileURLToPath(new URL('../node_modules/' + VENDORS.get(pathname), import.meta.url)),
            'utf8',
          );
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(raw.replaceAll("from 'three'", "from '/vendor/three.js'"));
        } else if (request.method === 'GET' && ASSETS.has(pathname)) {
          const [file, type] = ASSETS.get(pathname);
          const content = await readFile(fileURLToPath(new URL(`../web/${file}`, import.meta.url)));
          response.writeHead(200, { 'Content-Type': type });
          response.end(content);
        } else if (request.method === 'GET' && pathname === '/api/image-provider') {
          json(response, 200, imageProvider?.info ?? { id: 'image-compatible', configured: false });
        } else if (request.method === 'POST' && pathname === '/api/image-provider/generate') {
          const input = fields(await body(request), ['prompt', 'view', 'referenceId', 'consent']);
          if (!imageProvider?.info.configured)
            throw new AppError(409, 'IMAGE_NOT_CONFIGURED', '请先配置独立图像服务并重启。');
          if (input.consent !== imageProvider.info.configurationId)
            throw new AppError(400, 'CONSENT_REQUIRED', '请核对图像服务并确认本次发送内容。');
          if (active.has('image-generation'))
            throw new AppError(409, 'PLANNING_ACTIVE', '已有图像请求正在运行。');
          let reference = null;
          if (input.referenceId) {
            const asset = workshop.assets.get(input.referenceId);
            if (asset.kind !== 'image')
              throw new AppError(422, 'ASSET_TYPE', '参考图需要图片资源。');
            reference = asset.data;
          }
          const controller = new AbortController();
          active.set('image-generation', controller);
          const disconnect = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once('close', disconnect);
          try {
            json(
              response,
              200,
              await imageProvider.generate({ ...input, reference }, { signal: controller.signal }),
            );
          } finally {
            active.delete('image-generation');
            response.off('close', disconnect);
          }
        } else if (request.method === 'GET' && pathname === '/api/health') {
          json(response, 200, { ok: true, version: pkg.version, stage: capabilities().stage });
        } else if (request.method === 'GET' && pathname === '/api/targets') {
          json(response, 200, { targets: TARGETS });
        } else if (request.method === 'GET' && pathname === '/api/registries/items') {
          const target = getTarget(url.searchParams.get('target') ?? 'fabric-1.21.1');
          if (!target) throw new AppError(404, 'TARGET_UNAVAILABLE', '目标不存在。');
          json(response, 200, {
            targetId: target.id,
            items: vanillaItems(target.target).map((id) => 'minecraft:' + id),
          });
        } else if (request.method === 'GET' && pathname === '/api/capabilities') {
          json(response, 200, capabilities());
        } else if (request.method === 'GET' && pathname === '/api/examples/full-workshop') {
          const target = getTarget(url.searchParams.get('target') ?? 'fabric-1.21.1');
          if (!target?.enabled) throw new AppError(422, 'TARGET_UNAVAILABLE', '请选择可用目标。');
          const example = structuredClone(fullExample);
          example.target = { ...target.target };
          if (target.target.edition === 'bedrock') {
            example.items = example.items.filter((i) => ['basic_item', 'food'].includes(i.kind));
            const ids = new Set(
              [...example.items, ...example.blocks].map((i) => example.modId + ':' + i.id),
            );
            example.recipes = example.recipes.filter(
              (r) =>
                ids.has(r.result.item) &&
                [...Object.values(r.key ?? {}), ...(r.ingredients ?? [])].every(
                  (id) => id.startsWith('minecraft:') || ids.has(id),
                ),
            );
            example.assumptions.push(
              'Bedrock 样例仅包含此适配器支持的普通物品、食物、方块、配方和实体；尚未游戏实测。',
            );
          }
          json(response, 200, example);
        } else if (request.method === 'GET' && pathname === '/api/schema/mod-spec') {
          json(response, 200, modSpecSchema);
        } else if (request.method === 'GET' && pathname === '/api/providers') {
          json(response, 200, {
            providers: [
              { id: 'mock', label: '离线固定示例', configured: true, local: true },
              llmProvider?.info ?? {
                id: 'openai-compatible',
                label: '自定义 LLM',
                configured: false,
              },
            ],
          });
        } else if (
          request.method === 'POST' &&
          pathname === '/api/providers/openai-compatible/asset'
        ) {
          const input = fields(await body(request), ['consent', 'kind', 'prompt', 'referenceId']);
          requireConsent(input);
          if (
            !['texture', 'model'].includes(input.kind) ||
            typeof input.prompt !== 'string' ||
            !input.prompt.trim() ||
            input.prompt.length > 2000
          )
            throw new AppError(400, 'INVALID_INPUT', '请选择素材类型并填写 1–2000 字描述。');
          let reference;
          if (input.referenceId) {
            const asset = workshop.assets.get(input.referenceId);
            if (asset.kind !== 'image')
              throw new AppError(422, 'ASSET_TYPE', '请选择图片作为参考。');
            reference = asset.data;
          }
          json(
            response,
            200,
            await callModel(
              'asset-generation',
              { kind: input.kind, prompt: input.prompt, reference },
              response,
              'planAsset',
            ),
          );
        } else if (
          request.method === 'POST' &&
          pathname === '/api/providers/openai-compatible/test'
        ) {
          const input = fields(await body(request), ['consent']);
          requireConsent(input);
          const result = await callModel(
            'connection-test',
            {
              name: '连接验证',
              prompt: '一个普通物品，不需要配方。只用于验证接口与规格输出。',
              target: TARGET,
            },
            response,
          );
          json(response, 200, { ok: true, validatedSpec: true, source: result.source });
        } else if (request.method === 'GET' && pathname === '/api/projects') {
          json(response, 200, { projects: store.list().map(publicProject) });
        } else if (request.method === 'POST' && pathname === '/api/projects') {
          json(response, 201, publicProject(store.create(await body(request))));
        } else if (request.method === 'PATCH' && /^\/api\/projects\/[^/]+$/.test(pathname)) {
          const input = fields(await body(request), ['revision', 'name', 'archived']);
          json(response, 200, publicProject(store.updateDetails(pathname.split('/')[3], input)));
        } else if (
          request.method === 'POST' &&
          /^\/api\/projects\/[^/]+\/proposals$/.test(pathname)
        ) {
          const input = fields(await body(request), ['revision', 'provider', 'consent']);
          const project = store.get(pathname.split('/')[3]);
          store.assertRevision(project, input.revision);
          if (!['mock', 'openai-compatible'].includes(input.provider))
            throw new AppError(400, 'INVALID_PROVIDER', '请选择模型来源。');
          if (input.provider !== 'mock') requireConsent(input);
          const result =
            input.provider === 'mock'
              ? mockProvider.planProposals(project)
              : await callModel(project.id, project, response, 'planProposals');
          json(
            response,
            200,
            publicProject(store.setProposals(project.id, result, input.revision, result.source)),
          );
        } else if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/plan$/.test(pathname)) {
          const input = await body(request);
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            Object.keys(input).length
          ) {
            throw new AppError(400, 'INVALID_INPUT', '演示规划接口只接受空对象。');
          }
          json(response, 200, publicProject(store.plan(pathname.split('/')[3], mockProvider)));
        } else if (
          request.method === 'POST' &&
          /^\/api\/projects\/[^/]+\/spec\/generate$/.test(pathname)
        ) {
          const input = fields(await body(request), [
            'provider',
            'revision',
            'consent',
            'instruction',
            'repairBuildId',
          ]);
          if (!['mock', 'openai-compatible'].includes(input.provider))
            throw new AppError(400, 'INVALID_PROVIDER', '请选择离线示例或自定义 LLM。');
          const project = store.get(pathname.split('/')[3]);
          store.assertRevision(project, input.revision);
          if (
            input.instruction !== undefined &&
            (typeof input.instruction !== 'string' || input.instruction.length > 4000)
          )
            throw new AppError(400, 'INVALID_INPUT', '修改需求最多 4000 字。');
          if (input.instruction) project.instruction = input.instruction;
          if (input.repairBuildId) {
            const build = workshop.builds.get(input.repairBuildId);
            if (build.projectId !== project.id || build.status !== 'failed')
              throw new AppError(400, 'INVALID_INPUT', '只能分析本项目失败的构建。');
            project.buildFailure = build.log.slice(-6000);
          }
          if (input.provider !== 'mock') requireConsent(input);
          const result =
            input.provider === 'mock'
              ? mockProvider.planSpec(project)
              : await callModel(project.id, project, response);
          json(
            response,
            200,
            publicProject(
              store.setSpec(project.id, result.spec, input.revision, result.source, {
                instruction: input.instruction || project.prompt,
                reply:
                  (result.source.demo ? '离线固定示例。' : '模型规格已通过结构校验，等待审查。') +
                  '包含 ' +
                  result.spec.items.length +
                  ' 个物品、' +
                  (result.spec.blocks?.length ?? 0) +
                  ' 个方块、' +
                  result.spec.recipes.length +
                  ' 个配方。' +
                  result.spec.assumptions.join('；'),
              }),
            ),
          );
        } else if (
          request.method === 'POST' &&
          /^\/api\/projects\/[^/]+\/spec\/cancel$/.test(pathname)
        ) {
          fields(await body(request), []);
          const project = store.get(pathname.split('/')[3]);
          const controller = active.get(project.id);
          controller?.abort();
          json(response, 200, { cancelled: !!controller });
        } else if (request.method === 'PUT' && /^\/api\/projects\/[^/]+\/spec$/.test(pathname)) {
          const input = fields(await body(request), ['spec', 'revision']);
          json(
            response,
            200,
            publicProject(store.setSpec(pathname.split('/')[3], input.spec, input.revision)),
          );
        } else if (
          request.method === 'POST' &&
          /^\/api\/projects\/[^/]+\/spec\/confirm$/.test(pathname)
        ) {
          const input = fields(await body(request), ['revision']);
          json(
            response,
            200,
            publicProject(store.confirmSpec(pathname.split('/')[3], input.revision)),
          );
        } else if (
          request.method === 'GET' &&
          /^\/api\/projects\/[^/]+\/spec\/history$/.test(pathname)
        ) {
          json(response, 200, { history: store.history(pathname.split('/')[3]), limit: 20 });
        } else if (
          request.method === 'GET' &&
          /^\/api\/projects\/[^/]+\/spec\/history\/\d+$/.test(pathname)
        ) {
          json(
            response,
            200,
            store.snapshot(pathname.split('/')[3], Number(pathname.split('/')[6])),
          );
        } else if (
          request.method === 'POST' &&
          /^\/api\/projects\/[^/]+\/spec\/restore$/.test(pathname)
        ) {
          const input = fields(await body(request), ['fromRevision', 'revision']);
          json(
            response,
            200,
            publicProject(
              store.restoreSpec(pathname.split('/')[3], input.fromRevision, input.revision),
            ),
          );
        } else if (
          request.method === 'GET' &&
          /^\/api\/projects\/[^/]+\/spec\/export$/.test(pathname)
        ) {
          const project = store.get(pathname.split('/')[3]);
          if (!project.spec) throw new AppError(409, 'SPEC_REQUIRED', '请先生成或保存规格。');
          response.setHeader(
            'Content-Disposition',
            'attachment; filename="' + project.spec.modId + '.modspec.json"',
          );
          json(response, 200, project.spec);
        } else if (request.method === 'GET' && /^\/api\/projects\/[^/]+$/.test(pathname)) {
          json(response, 200, publicProject(store.get(pathname.split('/')[3])));
        } else {
          throw new AppError(404, 'NOT_FOUND', '接口或文件不存在。');
        }
      } catch (error) {
        const known = error instanceof AppError;
        if (!known) console.error('[minemod] Internal request failure');
        if (!response.destroyed && !response.headersSent) {
          json(response, known ? error.status : 500, {
            error: {
              code: known ? error.code : 'INTERNAL_ERROR',
              message: known ? error.message : '本地服务发生错误。',
            },
          });
        }
      }
    },
  );
  server.once('error', releaseLock);
  server.on('close', () => {
    for (const controller of active.values()) controller.abort();
    void workshop.builds.close().finally(releaseLock);
  });
  server.workshop = workshop;
  return server;
}
