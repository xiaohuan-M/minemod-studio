import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { workshopServices } from '../src/workshop-routes.mjs';
import { acquireDataLock } from '../src/storage/data-lock.mjs';
import { sha256 } from '../src/core/archive.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import { defaultEntityAnimation } from '../src/core/animation.mjs';
import specFixture from '../examples/project-spec.json' with { type: 'json' };
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-backup-'));
  const store = new ProjectStore(dir),
    services = workshopServices(dir, store);
  t.after(async () => {
    await services.builds.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, ...services };
}
function sign(value) {
  delete value.checksum;
  value.checksum = sha256(JSON.stringify(value));
  return value;
}
test('portable project backup includes assets, history, source and artifacts; import is isolated and cannot execute imported workspaces', async (t) => {
  const a = setup(t),
    b = setup(t),
    asset = a.assets.create({
      kind: 'texture',
      name: '可迁移贴图',
      source: '原创',
      license: 'CC0',
      data: placeholderTexture(),
    });
  const spec = structuredClone(specFixture);
  spec.target = { edition: 'bedrock', loader: 'bedrock', minecraft: '1.21.60', java: 0 };
  spec.items[0].textureAsset = asset.id;
  const animated = a.assets.create({
    kind: 'animated_model',
    name: '可迁移动画',
    source: '原创',
    license: 'CC0',
    data: defaultEntityAnimation('cow'),
  });
  spec.entities = [
    {
      id: 'actor',
      displayName: { zh_cn: '角色', en_us: 'Actor' },
      archetype: 'cow',
      health: 10,
      movementSpeed: 0.2,
      attackDamage: 0,
      modelAsset: animated.id,
    },
  ];
  let p = a.store.create({ name: '备份测试', prompt: '物品与贴图', targetId: 'bedrock-1.21.60' });
  p = a.store.setSpec(p.id, spec, p.revision);
  p = a.store.confirmSpec(p.id, p.revision);
  const w = a.workspaces.generate(p);
  p = a.store.attachWorkspace(p.id, w, p.revision);
  p = a.store.approveWorkspace(p.id, w.hash, p.revision);
  const build = await a.builds.start(p.id, w.hash, { approval: w.hash });
  assert.equal(a.builds.get(build.id).status, 'passed');
  const exported = a.backup.export(p.id),
    imported = b.backup.import(exported);
  assert.notEqual(imported.id, p.id);
  assert.equal(imported.confirmedSpecHash, null);
  assert.equal(imported.approvedWorkspaceHash, undefined);
  assert.deepEqual(b.assets.get(asset.id).data, asset.data);
  assert.equal(b.workspaces.list(imported.id).length, 1);
  const record = b.builds.list(imported.id)[0];
  assert.equal(record.imported, true);
  assert.equal(record.gameTested, false);
  assert.equal(b.builds.artifact(record.id).bytes.length, a.builds.artifact(build.id).bytes.length);
  await assert.rejects(
    b.builds.start(imported.id, w.hash, { approval: w.hash }),
    (e) => e.code === 'IMPORTED_WORKSPACE',
  );
  let approved = b.store.confirmSpec(imported.id, imported.revision);
  const regenerated = b.workspaces.generate(approved);
  assert.equal(regenerated.hash, w.hash);
  assert.equal(regenerated.imported, undefined);
  const duplicate = b.backup.import(exported);
  assert.notEqual(duplicate.id, imported.id);
  assert.equal(b.assets.list().length, 2);
  const corrupt = structuredClone(exported);
  corrupt.project.name = 'changed';
  assert.throws(() => b.backup.import(corrupt), /校验/);
  const missing = structuredClone(exported);
  missing.assets = [];
  assert.throws(() => b.backup.import(sign(missing)), /缺少/);
  assert.equal(b.store.list().length, 2);
  const unsafe = structuredClone(exported);
  unsafe.workspaces[0].files[0].path = '../outside';
  assert.throws(() => b.backup.import(sign(unsafe)));
  assert.equal(b.store.list().length, 2);
});
test('writer guard rejects concurrent instances and releases only its own lock', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const release = acquireDataLock(dir);
  assert.throws(
    () => acquireDataLock(dir),
    (e) => e.code === 'DATA_IN_USE',
  );
  release();
  const second = acquireDataLock(dir);
  release();
  assert.throws(() => acquireDataLock(dir));
  second();
});
