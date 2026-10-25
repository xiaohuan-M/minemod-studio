import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetOrigins, normalizeOrigins } from '../src/core/asset-origins.mjs';
import { materialNeeded, materialSignature } from '../src/creation/materials.mjs';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { workshopServices } from '../src/workshop-routes.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { TARGETS } from '../src/core/targets.ts';
import full from '../examples/full-workshop.json' with { type: 'json' };

test('resuming a forced redraw skips completed bindings but redoes changed briefs and honors explicit rebindings', () => {
  const owner = { id: 'a', kind: 'basic_item', textureAsset: 'one', texturePrompt: 'red' },
    task = { options: { refreshMaterials: true }, assetJobs: [] };
  assert.equal(materialNeeded(task, 'items', owner, owner, 'texture'), true);
  task.assetJobs.push({
    group: 'items',
    ownerId: 'a',
    kind: 'texture',
    assetId: 'one',
    requestHash: materialSignature(owner, 'texture'),
  });
  assert.equal(materialNeeded(task, 'items', owner, owner, 'texture'), false);
  assert.equal(
    materialNeeded(task, 'items', { ...owner, texturePrompt: 'blue' }, owner, 'texture'),
    true,
  );
  task.options.refreshMaterials = false;
  assert.equal(
    materialNeeded(
      task,
      'items',
      { ...owner, textureAsset: 'two', textureColor: '#ffffff' },
      owner,
      'texture',
    ),
    false,
  );
});

test('attribution roots survive repeated editing, every target source and asset/project packages without changing data hashes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-materials-')),
    contexts = [];
  t.after(async () => {
    await Promise.all(contexts.map((c) => c.builds.close()));
    rmSync(dir, { recursive: true, force: true });
  });
  const setup = (name) => {
    const root = join(dir, name),
      store = new ProjectStore(root),
      c = { store, ...workshopServices(root, store) };
    contexts.push(c);
    return c;
  };
  const a = setup('a'),
    b = setup('b'),
    texture = a.assets.create({
      kind: 'texture',
      name: '原创贴图',
      source: 'Artist',
      license: 'CC-BY-4.0',
      data: placeholderTexture(),
    });
  const model = a.assets.create({
    kind: 'model',
    name: '原创模型',
    source: 'Builder',
    license: 'CC-BY-4.0',
    data: { elements: [{ from: [0, 0, 0], to: [8, 8, 8] }], texture: texture.data },
    derivedFrom: assetOrigins(texture),
  });
  let edited = model;
  for (let i = 0; i < 80; i++) edited = { ...edited, derivedFrom: assetOrigins(edited, texture) };
  assert.equal(edited.derivedFrom.length, 2);
  assert.ok(edited.derivedFrom.some((o) => o.id === model.id));
  const derived = a.assets.create({
    kind: 'model',
    name: '修改模型',
    source: 'LLM: fixture',
    license: model.license,
    data: model.data,
    derivedFrom: assetOrigins(edited),
  });
  assert.equal(derived.sha256, model.sha256);
  for (const target of TARGETS) {
    const spec = structuredClone(full);
    spec.target = { ...target.target };
    spec.entities = [];
    spec.blocks[0].modelAsset = derived.id;
    if (target.target.edition === 'bedrock')
      spec.items = spec.items.filter((i) => ['food', 'basic_item'].includes(i.kind));
    const files = workspaceFiles(generateWorkspace(spec, [derived]));
    assert.deepEqual(JSON.parse(files['ASSETS.json'])[0].derivedFrom, derived.derivedFrom);
  }
  const imported = b.assets.importPackage(a.assets.exportPackage([derived.id]))[0];
  assert.deepEqual(imported.derivedFrom, derived.derivedFrom);
  const spec = structuredClone(full);
  spec.blocks[0].modelAsset = derived.id;
  let p = a.store.create({ name: '来源迁移', prompt: '测试归属摘要', targetId: 'fabric-1.21.1' });
  p = a.store.setSpec(p.id, spec, p.revision);
  const restored = b.backup.import(a.backup.export(p.id));
  assert.deepEqual(
    b.assets.get(restored.spec.blocks[0].modelAsset).derivedFrom,
    derived.derivedFrom,
  );
  for (const bad of [
    [{ ...derived.derivedFrom[0], prompt: 'private' }],
    [{ ...derived.derivedFrom[0], sha256: 'bad' }],
    Array(65).fill(derived.derivedFrom[0]),
    [derived.derivedFrom[0], { ...derived.derivedFrom[0], license: 'different' }],
  ])
    assert.throws(
      () => normalizeOrigins(bad),
      (e) => e.code === 'INVALID_ASSET_ORIGINS',
    );
});
