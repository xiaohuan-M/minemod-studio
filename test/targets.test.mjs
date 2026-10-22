import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { makeServer } from '../src/server.mjs';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { validateModSpec } from '../src/core/mod-spec.mjs';
import { readZipEntry, sha256 } from '../src/core/archive.mjs';
import example from '../examples/full-workshop.json' with { type: 'json' };
test('Fabric 1.20.1 adapter uses the matching Java, food API, plural data paths and legacy recipe result', () => {
  const spec = structuredClone(example);
  spec.target = { edition: 'java', loader: 'fabric', minecraft: '1.20.1', java: 17 };
  const files = workspaceFiles(generateWorkspace(spec));
  assert.match(files['build.gradle'].toString(), /options.release = 17/);
  assert.equal(JSON.parse(files['src/main/resources/fabric.mod.json']).depends.java, '>=17');
  assert.equal(
    JSON.parse(files['src/main/resources/data/full_workshop/recipes/glow_block.json']).result.item,
    'full_workshop:glow_block',
  );
  assert.match(
    Object.entries(files)
      .find(([p]) => p.endsWith('GeneratedMod.java'))[1]
      .toString(),
    /\.hunger\(5\)/,
  );
  spec.target.java = 21;
  assert.throws(() => validateModSpec(spec), /组合/);
});
test('Bedrock HTTP lifecycle produces valid nested packs without invoking Docker and retains source provenance', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-targets-'));
  const server = makeServer({ dataDir: dir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.workshop.builds.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function req(path, method = 'GET', data) {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.equal(r.ok, true, await (r.ok ? Promise.resolve('') : r.clone().text()));
    return r;
  }
  async function json(...args) {
    return (await req(...args)).json();
  }
  const spec = await json('/api/examples/full-workshop?target=bedrock-1.21.60');
  let p = await json('/api/projects', 'POST', {
    name: '基岩版',
    prompt: '食物与发光方块',
    targetId: 'bedrock-1.21.60',
  });
  const root = '/api/projects/' + p.id;
  p = await json(root + '/spec', 'PUT', { revision: p.revision, spec });
  p = await json(root + '/spec/confirm', 'POST', { revision: p.revision });
  const generated = await json(root + '/workspaces', 'POST', { revision: p.revision });
  p = generated.project;
  p = await json(root + '/workspaces/' + p.workspaceHash + '/approve', 'POST', {
    revision: p.revision,
  });
  let b = await json(root + '/builds', 'POST', {
    revision: p.revision,
    snapshotHash: p.workspaceHash,
    allowNetwork: false,
  });
  b = await json('/api/builds/' + b.id);
  assert.equal(b.status, 'passed');
  assert.equal(b.image, null);
  assert.equal(b.gameTested, false);
  const bytes = Buffer.from(await (await req('/api/builds/' + b.id + '/artifact')).arrayBuffer());
  assert.equal(sha256(bytes), b.artifact.sha256);
  const bp = readZipEntry(bytes, 'behavior_pack.mcpack'),
    rp = readZipEntry(bytes, 'resource_pack.mcpack');
  const bm = JSON.parse(readZipEntry(bp, 'manifest.json')),
    rm = JSON.parse(readZipEntry(rp, 'manifest.json'));
  assert.equal(bm.dependencies[0].uuid, rm.header.uuid);
  assert.deepEqual(bm.header.min_engine_version, [1, 21, 60]);
  assert.equal(
    JSON.parse(readZipEntry(bp, 'items/food.json'))['minecraft:item'].components['minecraft:food']
      .nutrition,
    5,
  );
  const atlas = JSON.parse(readZipEntry(rp, 'textures/item_texture.json'));
  for (const { textures } of Object.values(atlas.texture_data))
    assert.equal(readZipEntry(rp, textures + '.png')[0], 137);
  const bundle = Buffer.from(await (await req('/api/builds/' + b.id + '/bundle')).arrayBuffer());
  assert.match(readZipEntry(bundle, 'INSTALL.md').toString(), /Bedrock/);
  assert.equal((await fetch(base + '/api/builds/' + b.id + '/jar')).status, 409);
  const copy = await json(root + '/clone', 'POST', {});
  assert.deepEqual(copy.target, p.target);
  const invalid = structuredClone(spec);
  invalid.items.push(example.items.find((i) => i.kind === 'sword'));
  assert.throws(() => validateModSpec(invalid), /Bedrock/);
});
