import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { workshopServices } from '../src/workshop-routes.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import rig from '../examples/rigged-guardian.json' with { type: 'json' };
import fixture from '../examples/project-spec.json' with { type: 'json' };

test('hierarchical textured assets, source and complete versions migrate without changing canonical geometry or granting execution', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-rig-storage-')),
    contexts = [];
  const setup = (name) => {
    const root = join(dir, name),
      store = new ProjectStore(root),
      services = workshopServices(root, store);
    const context = { store, ...services };
    contexts.push(context);
    return context;
  };
  t.after(async () => {
    await Promise.all(contexts.map((c) => c.builds.close()));
    rmSync(dir, { recursive: true, force: true });
  });
  const a = setup('a'),
    b = setup('b'),
    asset = a.assets.create({
      kind: 'animated_model',
      name: '层级角色',
      source: 'original',
      license: 'CC0-1.0',
      data: { ...rig, texture: placeholderTexture('#aa6644', true) },
    }),
    spec = structuredClone(fixture);
  spec.target = { edition: 'bedrock', loader: 'bedrock', minecraft: '1.21.60', java: 0 };
  spec.entities = [
    {
      id: 'rig_guard',
      displayName: { zh_cn: '骨骼守卫', en_us: 'Rig Guard' },
      archetype: 'cow',
      health: 20,
      movementSpeed: 0.2,
      attackDamage: 0,
      modelAsset: asset.id,
      animationClip: 'wave',
    },
  ];
  let project = a.store.create({
    name: '完整层级模型',
    prompt: '可挥手的角色',
    targetId: 'bedrock-1.21.60',
  });
  project = a.store.setSpec(project.id, spec, project.revision);
  project = a.store.confirmSpec(project.id, project.revision);
  const source = a.workspaces.generate(project);
  project = a.store.attachWorkspace(project.id, source, project.revision);
  project = a.store.approveWorkspace(project.id, source.hash, project.revision);
  const built = await a.builds.start(project.id, source.hash, { approval: source.hash });
  assert.equal(a.builds.get(built.id).status, 'passed');
  a.versions.capture(project.id, { label: '可迁移版本' });
  const backup = a.backup.export(project.id),
    imported = b.backup.import(backup),
    restored = b.assets.get(imported.spec.entities[0].modelAsset);
  assert.deepEqual(restored.data, asset.data);
  assert.equal(restored.sha256, asset.sha256);
  assert.equal(b.versions.list(imported.id).length, 1);
  assert.equal(imported.approvedWorkspaceHash, undefined);
  const confirmed = b.store.confirmSpec(imported.id, imported.revision),
    regenerated = b.workspaces.generate(confirmed);
  assert.equal(regenerated.hash, source.hash);
});
