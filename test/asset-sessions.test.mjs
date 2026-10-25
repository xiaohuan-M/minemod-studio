import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer } from '../src/server.mjs';
import { assetData } from '../src/core/asset-generation.mjs';
import { defaultEntityAnimation } from '../src/core/animation.mjs';

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
    })
  ).json();
  const first = session.currentAssetId;
  assert.equal(session.data.elements[0].to[1], 9);
  session = await (
    await call(url + '/generate', 'POST', {
      revision: session.revision,
      prompt: '再加长一点',
      consent: 'session-consent',
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
