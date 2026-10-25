import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer } from '../src/server.mjs';
import { assetData } from '../src/core/asset-generation.mjs';
import { defaultEntityAnimation } from '../src/core/animation.mjs';
import { placeholderTexture, pngTexture } from '../src/core/assets.mjs';

test('material sessions send the current model/history, retain immutable rounds and restore without another API call', async (t) => {
  const contexts = [],
    dir = mkdtempSync(join(tmpdir(), 'minemod-asset-session-'));
  const server = makeServer({
    dataDir: dir,
    llmProvider: {
      info: { configured: true, configurationId: 'session-consent', model: 'session-fixture' },
      async planAsset(input) {
        contexts.push(input);
        const data = structuredClone(
          input.currentData ?? { elements: [{ from: [1, 0, 1], to: [8, 8, 8] }] },
        );
        data.elements[0].to[1] += 1;
        return { kind: input.kind, data, source: { provider: 'test-fixture', demo: true } };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, method = 'GET', input) =>
    fetch('http://127.0.0.1:' + server.address().port + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  let session = await (
    await call('/api/asset-sessions', 'POST', { kind: 'model', name: '水晶法杖' })
  ).json();
  const url = '/api/asset-sessions/' + session.id;
  assert.equal(
    (await call(url + '/generate', 'POST', { revision: 0, prompt: '加长', consent: 'old' })).status,
    400,
  );
  session = await (
    await call(url + '/generate', 'POST', {
      revision: 0,
      prompt: '做一根法杖',
      consent: 'session-consent',
      withTexture: false,
    })
  ).json();
  const first = session.currentAssetId;
  assert.equal(session.data.elements[0].to[1], 9);
  session = await (
    await call(url + '/generate', 'POST', {
      revision: session.revision,
      prompt: '再加长一点',
      consent: 'session-consent',
      withTexture: false,
    })
  ).json();
  assert.equal(session.data.elements[0].to[1], 10);
  assert.equal(contexts[1].currentData.elements[0].to[1], 9);
  assert.deepEqual(contexts[1].conversation, ['做一根法杖']);
  assert.equal(session.history.length, 2);
  assert.equal((await call(url + '/restore', 'POST', { revision: 0, assetId: first })).status, 409);
  session = await (
    await call(url + '/restore', 'POST', { revision: session.revision, assetId: first })
  ).json();
  assert.equal(session.data.elements[0].to[1], 9);
  assert.equal(contexts.length, 2);
  assert.equal(server.workshop.assets.get(first).data.elements[0].to[1], 9);
  assert.equal((await (await call('/api/asset-sessions')).json()).sessions.length, 1);
});

test('compact pixel runs and animated asset data normalize to the existing immutable asset formats', () => {
  const pixels = assetData('texture', {
    width: 64,
    height: 64,
    palette: ['#ff0000ff', '#00000000'],
    runs: [
      [0, 2048],
      [1, 2048],
    ],
  });
  assert.equal(pixels.pixels.length, 4096);
  assert.equal(pixels.pixels[2048], '#00000000');
  assert.throws(
    () => assetData('texture', { width: 16, height: 16, palette: ['#ffffffff'], runs: [[0, 257]] }),
    { code: 'INVALID_ASSET' },
  );
  assert.throws(
    () => assetData('texture', { width: 16, height: 16, palette: ['#ffffffff'], runs: [[2, 256]] }),
    { code: 'INVALID_ASSET' },
  );
  const animated = defaultEntityAnimation('cow');
  assert.deepEqual(assetData('animated_model', animated), animated);
});

test('one model prompt generates a textured editable bbmodel; subsequent geometry edits retain the same texture', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-textured-model-')),
    calls = [];
  const texture = placeholderTexture('#a34f92');
  const server = makeServer({
    dataDir: dir,
    llmProvider: {
      info: { configured: true, configurationId: 'textured-model' },
      async planAsset(input) {
        calls.push(input);
        return {
          kind: input.kind,
          data:
            input.kind === 'texture'
              ? texture
              : { elements: [{ from: [2, 0, 2], to: [14, 16, 14] }] },
          source: { provider: 'fixture', demo: true, usage: { inputTokens: 5, outputTokens: 7 } },
        };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, method = 'GET', input) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  let s = await (
    await call('/api/asset-sessions', 'POST', { kind: 'model', name: '完整水晶模型' })
  ).json();
  const path = '/api/asset-sessions/' + s.id;
  s = await (
    await call(path + '/generate', 'POST', {
      revision: s.revision,
      prompt: '一把紫色水晶剑',
      consent: 'textured-model',
    })
  ).json();
  assert.deepEqual(s.data.texture, texture);
  assert.equal(calls.length, 2);
  assert.equal(s.history[0].source.usage.inputTokens, 10);
  const bb = await (await call('/api/assets/' + s.currentAssetId + '/bbmodel')).json();
  assert.deepEqual(Buffer.from(bb.textures[0].source.split(',')[1], 'base64'), pngTexture(texture));
  const imported = await (
    await call('/api/blockbench/import', 'POST', {
      model: bb,
      name: '导回模型',
      source: '原创测试',
      license: 'CC0',
    })
  ).json();
  assert.deepEqual(imported.assets.find((a) => a.kind === 'model').data.texture, texture);
  s = await (
    await call(path + '/generate', 'POST', {
      revision: s.revision,
      prompt: '剑柄加长',
      consent: 'textured-model',
    })
  ).json();
  assert.deepEqual(s.data.texture, texture);
  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].currentData.texture,
    undefined,
    'Geometry edits do not resend and regenerate the pixel array',
  );
});
