import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProfile } from '../src/core/provider-profile.mjs';
import { ProviderProfileStore } from '../src/storage/provider-profile-store.mjs';
import { makeServer } from '../src/server.mjs';
import { pngTexture, placeholderTexture } from '../src/core/assets.mjs';
import spec from '../examples/project-spec.json' with { type: 'json' };

const local = {
  name: '本机文本',
  kind: 'text',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'local-fixture',
  apiKey: 'fixture-only-not-real',
};
const dirFixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  await server.workshop?.builds.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
function caller(base) {
  return async (path, method = 'GET', data) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
}
const endpoint = '/api/settings/providers';
const textInfo = async (call) =>
  (await (await call('/api/providers')).json()).providers.find((p) => p.id === 'openai-compatible');

test('provider settings preserve secret values only in private storage, enforce revisions and survive restart', (t) => {
  const dir = dirFixture(t),
    store = new ProviderProfileStore(dir);
  let state = store.save(local, 0);
  assert.equal(state.revision, 1);
  const profile = state.profiles[0];
  assert.equal(profile.hasApiKey, true);
  assert.ok(!JSON.stringify(state).includes(local.apiKey));
  assert.throws(() => store.activate('text', profile.id, 0), { code: 'SETTINGS_CHANGED' });
  state = store.activate('text', profile.id, 1);
  state = store.save(
    { ...local, model: 'changed-model', apiKey: undefined },
    state.revision,
    profile.id,
  );
  assert.equal(store.selected('text').apiKey, local.apiKey);
  assert.throws(() => store.remove(profile.id, state.revision), { code: 'PROFILE_IN_USE' });
  const restored = new ProviderProfileStore(dir);
  assert.equal(restored.selected('text').model, 'changed-model');
  const path = join(dir, 'settings', readdirSync(join(dir, 'settings'))[0]);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  const broken = readFileSync(path, 'utf8');
  writeFileSync(path, '{broken');
  assert.throws(() => new ProviderProfileStore(dir), { code: 'RECORD_CORRUPT' });
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  writeFileSync(path, broken);
  state = restored.activate('text', null, state.revision);
  state = restored.save({ ...local, apiKey: '' }, state.revision, profile.id);
  assert.equal(state.profiles[0].hasApiKey, false);
  assert.equal(restored.remove(profile.id, state.revision).profiles.length, 0);
});

test('provider profiles reject credential URLs, insecure remote endpoints, unknown options and invalid types without echoing input', () => {
  for (const change of [
    { baseUrl: 'http://external.example/v1' },
    { baseUrl: 'https://user:fixture-secret@external.example/v1' },
    { baseUrl: 'https://external.example/v1?key=fixture-secret' },
    { baseUrl: 'file:///tmp/private' },
    { kind: 'other' },
    { apiKey: 'fixture-secret\n' },
    { options: { timeoutMs: 0 } },
    { options: { jsonMode: 'yes' } },
    { options: { apiKey: 'fixture-secret' } },
    { options: { toString: 'fixture-secret' } },
    { kind: 'image', options: { maxTokens: 500 } },
  ])
    assert.throws(
      () => normalizeProfile({ ...local, ...change }),
      (error) =>
        error.code === 'INVALID_PROVIDER_PROFILE' && !error.message.includes('fixture-secret'),
    );
  assert.throws(
    () => normalizeProfile({ ...local, baseUrl: 'https://external.example/v1', apiKey: '' }),
    { code: 'INVALID_PROVIDER_PROFILE' },
  );
  assert.equal(normalizeProfile({ ...local, apiKey: '' }).apiKey, '');
});

test('HTTP profile switching uses independent text/image services without restart and invalidates stale consent', async (t) => {
  const dir = dirFixture(t),
    calls = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      path: request.url,
      auth: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url.endsWith('/images/generations')
          ? { data: [{ b64_json: pngTexture(placeholderTexture()).toString('base64') }] }
          : { choices: [{ message: { content: JSON.stringify(spec) } }] },
      ),
    );
  });
  const upstreamBase = await listen(upstream);
  t.after(() => close(upstream));
  let server = makeServer({ dataDir: dir }),
    base = await listen(server),
    call = caller(base);
  t.after(async () => {
    if (server.listening) await close(server);
  });
  let result = await call(endpoint, 'POST', {
    revision: 0,
    ...local,
    baseUrl: upstreamBase + '/v1',
  });
  assert.equal(result.status, 201);
  let state = await result.json();
  const text = state.profiles[0];
  state = await (
    await call(endpoint, 'POST', {
      revision: state.revision,
      name: '图片服务',
      kind: 'image',
      baseUrl: upstreamBase + '/v1',
      model: 'image-fixture',
      apiKey: 'image-fixture-key',
    })
  ).json();
  const image = state.profiles.find((p) => p.kind === 'image');
  assert.equal(calls.length, 0, 'saving configuration must never call the supplier');
  state = await (
    await call(endpoint + '/activate', 'POST', {
      revision: state.revision,
      kind: 'text',
      profileId: text.id,
    })
  ).json();
  const before = await textInfo(call);
  state = await (
    await call(endpoint + '/activate', 'POST', {
      revision: state.revision,
      kind: 'image',
      profileId: image.id,
    })
  ).json();
  assert.equal(
    (
      await call('/api/providers/openai-compatible/test', 'POST', {
        consent: before.configurationId,
      })
    ).status,
    400,
  );
  const info = await textInfo(call);
  assert.equal(info.configured, true);
  assert.equal(
    (await call('/api/providers/openai-compatible/test', 'POST', { consent: info.configurationId }))
      .status,
    200,
  );
  const imageInfo = await (await call('/api/image-provider')).json();
  const generated = await call('/api/image-provider/generate', 'POST', {
    prompt: 'fixture',
    view: 'concept',
    consent: imageInfo.configurationId,
  });
  assert.equal(generated.status, 200);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/v1/chat/completions', '/v1/images/generations'],
  );
  assert.deepEqual(
    calls.map((c) => c.auth),
    ['Bearer ' + local.apiKey, 'Bearer image-fixture-key'],
  );
  assert.equal(
    (await call(endpoint + '/activate', 'POST', { revision: 0, kind: 'text', profileId: null }))
      .status,
    409,
  );
  assert.equal(
    (await call(endpoint + '/' + text.id, 'DELETE', { revision: state.revision })).status,
    409,
  );
  for (const path of [endpoint, '/api/providers', '/api/image-provider']) {
    const body = await (await call(path)).text();
    assert.ok(!body.includes(local.apiKey) && !body.includes('image-fixture-key'));
  }
  const project = await (
    await call('/api/projects', 'POST', { name: '备份', prompt: '验证密钥不导出' })
  ).json();
  const backup = await (await call('/api/projects/' + project.id + '/backup')).text();
  assert.ok(
    !backup.includes(local.apiKey) &&
      !backup.includes('image-fixture-key') &&
      !backup.includes('settings/'),
  );
  const denied = await fetch(base + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://outside.example' },
    body: JSON.stringify({ revision: state.revision, ...local }),
  });
  assert.equal(denied.status, 403);
  await close(server);
  server = makeServer({ dataDir: dir });
  base = await listen(server);
  call = caller(base);
  assert.equal((await textInfo(call)).model, local.model);
  assert.equal((await (await call('/api/image-provider')).json()).model, 'image-fixture');
  assert.equal(calls.length, 2, 'restarting must not contact suppliers');
});

test('running model requests block configuration writes and keep their original destination', async (t) => {
  const dir = dirFixture(t);
  let signalStarted, release;
  const started = new Promise((r) => {
    signalStarted = r;
  });
  const gate = new Promise((r) => {
    release = r;
  });
  const upstream = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    signalStarted();
    await gate;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(spec) } }] }));
  });
  const upstreamBase = await listen(upstream);
  t.after(async () => {
    release();
    await close(upstream);
  });
  const server = makeServer({ dataDir: dir }),
    base = await listen(server),
    call = caller(base);
  t.after(() => close(server));
  let state = await (
    await call(endpoint, 'POST', { revision: 0, ...local, baseUrl: upstreamBase + '/v1' })
  ).json();
  state = await (
    await call(endpoint + '/activate', 'POST', {
      revision: state.revision,
      kind: 'text',
      profileId: state.profiles[0].id,
    })
  ).json();
  const info = await textInfo(call);
  const pending = call('/api/providers/openai-compatible/test', 'POST', {
    consent: info.configurationId,
  });
  await started;
  assert.equal(
    (
      await call(endpoint + '/activate', 'POST', {
        revision: state.revision,
        kind: 'text',
        profileId: null,
      })
    ).status,
    409,
  );
  assert.equal((await call(endpoint)).status, 200);
  release();
  assert.equal((await pending).status, 200);
  assert.equal(
    (
      await call(endpoint + '/activate', 'POST', {
        revision: state.revision,
        kind: 'text',
        profileId: null,
      })
    ).status,
    200,
  );
  assert.equal((await textInfo(call)).configured, false);
});
