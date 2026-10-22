// Explicit opt-in integration check: this command runs Docker and downloads dependencies.
import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.mjs';
import { readZipEntry, sha256 } from '../src/core/archive.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import { getTarget } from '../src/core/targets.ts';
import example from '../examples/full-workshop.json' with { type: 'json' };
const parent = resolve('.minemod');
mkdirSync(parent, { recursive: true });
const dataDir = mkdtempSync(join(parent, 'validation-'));
if (process.env.MINEMOD_TEST_GRADLE_CACHE) {
  const source = resolve(process.env.MINEMOD_TEST_GRADLE_CACHE);
  mkdirSync(join(dataDir, 'builds'), { recursive: true });
  cpSync(source, join(dataDir, 'builds', 'cache'), { recursive: true });
}
const server = makeServer({ dataDir });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
async function call(path, method = 'GET', value) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(value ? { body: JSON.stringify(value) } : {}),
  });
  if (!response.ok) throw new Error(path + ': ' + (await response.text()));
  return response;
}
async function json(path, method, value) {
  return (await call(path, method, value)).json();
}
const terminals = new Set(['passed', 'failed', 'cancelled', 'timed_out', 'interrupted']);
async function wait(id) {
  let old = '';
  for (;;) {
    const record = await json('/api/builds/' + id);
    if (record.status !== old) {
      console.log('build', id, record.status);
      old = record.status;
    }
    if (terminals.has(record.status)) return record;
    await setTimeout(1000);
  }
}
try {
  const status = await json(
    '/api/builder?target=' + (process.env.MINEMOD_TEST_TARGET ?? 'fabric-1.21.1'),
  );
  assert.ok(status.available && status.imageReady, 'Run npm run setup:builder first');
  const texture = await json('/api/assets', 'POST', {
    kind: 'texture',
    name: '集成贴图',
    source: '程序生成的测试素材',
    license: 'CC0',
    data: placeholderTexture('#62a482'),
  });
  const model = await json('/api/assets', 'POST', {
    kind: 'model',
    name: '集成立方体',
    source: '原创测试几何',
    license: 'CC0',
    data: { elements: [{ from: [5, 0, 5], to: [11, 14, 11] }] },
  });
  const spec = structuredClone(example);
  const targetId = process.env.MINEMOD_TEST_TARGET ?? 'fabric-1.21.1';
  assert.ok(
    ['fabric-1.21.1', 'fabric-1.20.1', 'forge-1.20.1', 'neoforge-1.21.1'].includes(targetId),
  );
  spec.target = { ...getTarget(targetId).target };
  spec.items[0].textureAsset = texture.id;
  spec.items[0].modelAsset = model.id;
  let p = await json('/api/projects', 'POST', {
    name: '真实集成构建',
    prompt: '完整内容、贴图与模型',
  });
  const root = '/api/projects/' + p.id;
  p = await json(root + '/spec', 'PUT', { revision: p.revision, spec });
  p = await json(root + '/spec/confirm', 'POST', { revision: p.revision });
  p = (await json(root + '/workspaces', 'POST', { revision: p.revision })).project;
  p = await json(root + '/workspaces/' + p.workspaceHash + '/approve', 'POST', {
    revision: p.revision,
  });
  const start = await json(root + '/builds', 'POST', {
    revision: p.revision,
    snapshotHash: p.workspaceHash,
    allowNetwork: true,
  });
  const passed = await wait(start.id);
  assert.equal(passed.status, 'passed', passed.log);
  const jar = Buffer.from(await (await call('/api/builds/' + passed.id + '/jar')).arrayBuffer());
  assert.equal(sha256(jar), passed.artifact.sha256);
  if (spec.target.loader === 'fabric') {
    assert.equal(JSON.parse(readZipEntry(jar, 'fabric.mod.json')).id, spec.modId);
    assert.equal(
      JSON.parse(readZipEntry(jar, 'fabric.mod.json')).depends.minecraft,
      spec.target.minecraft,
    );
  } else {
    const meta = JSON.parse(readZipEntry(jar, 'minemod-target.json'));
    assert.equal(meta.modId, spec.modId);
    assert.deepEqual(meta.target, spec.target);
  }

  readZipEntry(jar, 'studio/minemod/generated/m_full_workshop/GeneratedClient.class');
  readZipEntry(jar, 'assets/full_workshop/textures/entity/crystal_guard.png');
  readZipEntry(jar, 'assets/full_workshop/models/item/moss_cow_spawn_egg.json');
  assert.deepEqual(
    readZipEntry(jar, 'assets/full_workshop/textures/item/crystal.png'),
    Buffer.from(await (await call('/api/assets/' + texture.id + '/png')).arrayBuffer()),
  );
  const bundle = Buffer.from(
    await (await call('/api/builds/' + passed.id + '/bundle')).arrayBuffer(),
  );
  assert.deepEqual(readZipEntry(bundle, passed.artifact.name), jar);
  assert.equal(JSON.parse(readZipEntry(bundle, 'BUILD-REPORT.json')).status, 'passed');
  writeFileSync(join(dataDir, 'verified.jar'), jar);
  writeFileSync(join(dataDir, 'delivery.zip'), bundle);
  writeFileSync(join(dataDir, 'report.json'), JSON.stringify(passed, null, 2));
  const retry = await json(root + '/builds', 'POST', {
    revision: p.revision,
    snapshotHash: p.workspaceHash,
    allowNetwork: false,
  });
  await json('/api/builds/' + retry.id + '/cancel', 'POST', {});
  const cancelled = await wait(retry.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.artifact, null);
  assert.equal(
    sha256(Buffer.from(await (await call('/api/builds/' + passed.id + '/jar')).arrayBuffer())),
    passed.artifact.sha256,
  );
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        data: relative(process.cwd(), dataDir),
        snapshot: p.workspaceHash,
        artifact: passed.artifact,
        cancellation: cancelled.status,
        oldArtifactPreserved: true,
        gameTested: false,
      },
      null,
      2,
    ),
  );
} finally {
  await server.workshop.builds.close();
  await new Promise((resolve) => server.close(resolve));
}
