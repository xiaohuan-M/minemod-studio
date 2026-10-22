import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { makeServer } from '../src/server.mjs';
import { readZipEntry } from '../src/core/archive.mjs';
import { defaultEntityAnimation } from '../src/core/animation.mjs';
import spec from '../examples/full-workshop.json' with { type: 'json' };
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-workshop-'));
  const server = makeServer({ dataDir: dir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.workshop.builds.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (path, method = 'GET', data) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  return { call, server };
}
test('HTTP source lifecycle binds review to current snapshot and preserves old downloadable sources', async (t) => {
  const { call } = await fixture(t);
  let p = await (await call('/api/projects', 'POST', { name: '工程', prompt: '全功能' })).json();
  const root = '/api/projects/' + p.id;
  assert.equal((await call(root + '/workspaces', 'POST', { revision: p.revision })).status, 409);
  p = await (await call(root + '/spec', 'PUT', { revision: p.revision, spec })).json();
  p = await (await call(root + '/spec/confirm', 'POST', { revision: p.revision })).json();
  const generated = await (
    await call(root + '/workspaces', 'POST', { revision: p.revision })
  ).json();
  p = generated.project;
  const hash = generated.workspace.hash;
  assert.equal(
    (
      await call(root + '/builds', 'POST', {
        revision: p.revision,
        snapshotHash: hash,
        allowNetwork: false,
      })
    ).status,
    409,
  );
  const source = await call(root + '/workspaces/' + hash + '/source');
  assert.equal(source.status, 200);
  assert.deepEqual(
    JSON.parse(readZipEntry(Buffer.from(await source.arrayBuffer()), 'MODSPEC.json')),
    spec,
  );
  const unsafe = await call(
    root + '/workspaces/' + hash + '/file?path=' + encodeURIComponent('../../.env'),
  );
  assert.equal(unsafe.status, 404);
  p = await (
    await call(root + '/workspaces/' + hash + '/approve', 'POST', { revision: p.revision })
  ).json();
  assert.equal(p.approvedWorkspaceHash, hash);
  assert.equal(
    (
      await call(root + '/builds', 'POST', {
        revision: p.revision - 1,
        snapshotHash: hash,
        allowNetwork: false,
      })
    ).status,
    409,
  );
  p = await (await call(root + '/spec', 'PUT', { revision: p.revision, spec })).json();
  assert.equal(p.approvedWorkspaceHash, null);
  assert.equal(
    (
      await call(root + '/builds', 'POST', {
        revision: p.revision,
        snapshotHash: hash,
        allowNetwork: false,
      })
    ).status,
    409,
  );
  assert.equal((await call(root + '/workspaces/' + hash + '/source')).status, 200);
  const copy = await (await call(root + '/clone', 'POST', {})).json();
  assert.notEqual(copy.id, p.id);
  assert.deepEqual(copy.spec, p.spec);
  assert.equal(copy.confirmedSpecHash, null);
});
test('assets accept valid textures and static cubes but reject oversized, malformed and executable input', async (t) => {
  const { call } = await fixture(t);
  const payload = {
    name: '图',
    kind: 'texture',
    source: '原创',
    license: 'CC0',
    data: { width: 16, height: 16, pixels: Array(256).fill('#ff8800ff') },
  };
  const saved = await (await call('/api/assets', 'POST', payload)).json();
  assert.match(saved.id, /^[a-f0-9-]{36}$/);
  const png = await call('/api/assets/' + saved.id + '/png');
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await png.arrayBuffer()).byteLength > 40, true);
  assert.equal((await call('/api/assets', 'POST', { ...payload, command: 'bad' })).status, 400);
  assert.equal(
    (await call('/api/assets', 'POST', { ...payload, data: { ...payload.data, pixels: ['bad'] } }))
      .status,
    422,
  );
  assert.equal(
    (await call('/api/assets', 'POST', { ...payload, name: 'x'.repeat(1024 * 1024) })).status,
    413,
  );
  const model = await (
    await call('/api/assets', 'POST', {
      ...payload,
      kind: 'model',
      data: { elements: [{ from: [1, 1, 1], to: [5, 5, 5] }] },
    })
  ).json();
  assert.equal((await call('/api/assets/' + model.id + '/bbmodel')).status, 200);
});
test('unavailable builder fails honestly without a JAR; explicit network and snapshot consent required', async (t) => {
  const { server, call } = await fixture(t);
  server.workshop.builds.status = async () => ({
    available: false,
    imageReady: false,
    reason: '测试环境没有 Docker',
  });
  assert.equal((await call('/api/builder/prepare', 'POST', {})).status, 400);
  let p = await (
    await call('/api/projects', 'POST', { name: '构建失败', prompt: '无 Docker' })
  ).json();
  const root = '/api/projects/' + p.id;
  p = await (await call(root + '/spec', 'PUT', { revision: p.revision, spec })).json();
  p = await (await call(root + '/spec/confirm', 'POST', { revision: p.revision })).json();
  p = (await (await call(root + '/workspaces', 'POST', { revision: p.revision })).json()).project;
  p = await (
    await call(root + '/workspaces/' + p.workspaceHash + '/approve', 'POST', {
      revision: p.revision,
    })
  ).json();
  const started = await (
    await call(root + '/builds', 'POST', {
      revision: p.revision,
      snapshotHash: p.workspaceHash,
      allowNetwork: false,
    })
  ).json();
  const result = await (await call('/api/builds/' + started.id)).json();
  assert.equal(result.status, 'failed');
  assert.equal(result.artifact, null);
  assert.equal((await call('/api/builds/' + started.id + '/jar')).status, 409);
  assert.equal((await call('/api/builds/' + started.id + '/bundle')).status, 409);
});

test('animated asset downloads contain valid Bedrock resources and reimportable embedded bbmodel textures', async (t) => {
  const { call } = await fixture(t);
  const data = defaultEntityAnimation('cow');
  const response = await call('/api/assets', 'POST', {
    name: '动画牛',
    kind: 'animated_model',
    source: '原创',
    license: 'CC0',
    data,
  });
  assert.equal(response.status, 201);
  const asset = await response.json();
  const exported = await call('/api/assets/' + asset.id + '/bedrock');
  assert.equal(exported.status, 200);
  const zip = Buffer.from(await exported.arrayBuffer());
  assert.equal(
    JSON.parse(readZipEntry(zip, 'model.geo.json'))['minecraft:geometry'][0].bones.length,
    6,
  );
  assert.ok(
    JSON.parse(readZipEntry(zip, 'model.animation.json')).animations[
      'animation.minemod.export.walk'
    ],
  );
  assert.equal(readZipEntry(zip, 'texture.png').subarray(1, 4).toString(), 'PNG');
  const bbmodel = await call('/api/assets/' + asset.id + '/bbmodel');
  assert.equal(bbmodel.status, 200);
  const imported = await call('/api/blockbench/import', 'POST', {
    model: await bbmodel.json(),
    name: '重新导入',
    source: '原创',
    license: 'CC0',
  });
  assert.equal(imported.status, 201);
  const { assets } = await imported.json();
  assert.equal(assets.length, 2);
  assert.deepEqual(assets.find((a) => a.kind === 'animated_model').data, data);
});
