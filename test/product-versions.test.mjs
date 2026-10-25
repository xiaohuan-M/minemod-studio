import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { workshopServices } from '../src/workshop-routes.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import { signVersion } from '../src/storage/product-versions.mjs';
import { sha256, zipFiles } from '../src/core/archive.mjs';
import { workspaceFiles } from '../src/engineering/generator.mjs';
import { parseGameTestReceipt } from '../src/engineering/game-tests.mjs';
import example from '../examples/project-spec.json' with { type: 'json' };

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-version-'));
  const store = new ProjectStore(dir),
    services = workshopServices(dir, store);
  t.after(async () => {
    await services.builds.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, ...services };
}
test('full versions restore the round, retain exact source/artifact and survive portable backup migration', async (t) => {
  const a = setup(t),
    b = setup(t);
  const asset = a.assets.create({
    kind: 'texture',
    name: '第一版贴图',
    data: placeholderTexture(),
    source: '原创',
    license: 'CC0',
  });
  const spec = structuredClone(example);
  spec.target = { edition: 'bedrock', loader: 'bedrock', minecraft: '1.21.60', java: 0 };
  spec.items[0].textureAsset = asset.id;
  let p = a.store.create({ name: '第一版', prompt: '完整作品', targetId: 'bedrock-1.21.60' });
  p = a.store.setSpec(p.id, spec, p.revision, undefined, {
    instruction: '第一轮',
    reply: '已制作',
  });
  p = a.store.confirmSpec(p.id, p.revision);
  const w = a.workspaces.generate(p);
  p = a.store.attachWorkspace(p.id, w, p.revision);
  p = a.store.approveWorkspace(p.id, w.hash, p.revision);
  const build = await a.builds.start(p.id, w.hash, { approval: w.hash });
  const bytes = a.builds.artifact(build.id).bytes;
  const version = a.versions.capture(p.id, { label: '第一版可交付作品' });
  assert.equal(version.workspaceHash, w.hash);
  assert.deepEqual(version.buildIds, [build.id]);
  p = a.store.updateDetails(p.id, { revision: p.revision, name: '第二版' });
  const next = structuredClone(spec);
  delete next.items[0].textureAsset;
  next.displayName = '第二版';
  p = a.store.setSpec(p.id, next, p.revision, undefined, {
    instruction: '第二轮',
    reply: '修改了',
  });
  assert.throws(() => a.versions.restore(p.id, version.id, p.revision - 1), {
    code: 'PROJECT_CHANGED',
  });
  p = a.versions.restore(p.id, version.id, p.revision);
  assert.equal(p.name, '第一版');
  assert.equal(p.spec.items[0].textureAsset, asset.id);
  assert.equal(p.conversation.length, 1);
  assert.equal(p.workspaceHash, w.hash);
  assert.equal(p.approvedWorkspaceHash, null);
  assert.equal(p.confirmedSpecHash, null);
  assert.equal(a.versions.list(p.id).length, 2);
  assert.deepEqual(a.builds.artifact(build.id).bytes, bytes);
  const imported = b.backup.import(a.backup.export(p.id));
  const importedVersion = b.versions.list(imported.id).find((v) => v.label === version.label);
  assert.ok(importedVersion.imported);
  assert.notEqual(importedVersion.buildIds[0], build.id);
  assert.deepEqual(b.builds.artifact(importedVersion.buildIds[0]).bytes, bytes);
  const restored = b.versions.restore(imported.id, importedVersion.id, imported.revision);
  assert.equal(restored.name, '第一版');
  assert.equal(restored.spec.items[0].textureAsset, asset.id);
  assert.equal(b.workspaces.get(restored.id, w.hash).imported, true);
  await assert.rejects(b.builds.start(restored.id, w.hash, { approval: w.hash }), {
    code: 'IMPORTED_WORKSPACE',
  });
});

test('corrupt version manifests and missing backup references fail before restoring or importing', (t) => {
  const a = setup(t),
    b = setup(t);
  let p = a.store.create({ name: '版本校验', prompt: '校验' });
  p = a.store.setSpec(p.id, example, p.revision);
  const v = a.versions.capture(p.id);
  const changed = structuredClone(v);
  changed.project.spec.displayName = '被改过';
  a.versions.records(p.id).write(v.id, changed);
  assert.throws(() => a.versions.restore(p.id, v.id, p.revision), { code: 'VERSION_CORRUPT' });
  assert.equal(a.store.get(p.id).revision, p.revision);
  a.versions.records(p.id).write(v.id, signVersion({ ...v, workspaceHash: 'a'.repeat(64) }));
  assert.throws(() => a.versions.get(p.id, v.id));
  a.versions.records(p.id).write(v.id, v);
  const backup = a.backup.export(p.id);
  backup.versions[0].assets = [{ id: p.id, sha256: 'a'.repeat(64) }];
  backup.versions[0] = signVersion(backup.versions[0]);
  delete backup.checksum;
  backup.checksum = sha256(JSON.stringify(backup));
  assert.throws(() => b.backup.import(backup), { code: 'INVALID_BACKUP' });
  assert.equal(b.store.list().length, 0);
});

test('complete version distinguishes downloadable artifacts from server receipts and migrates proof without promoting external execution', (t) => {
  const a = setup(t),
    b = setup(t);
  let p = a.store.create({ name: '服务器证据', prompt: '保留检查结果' });
  p = a.store.setSpec(p.id, example, p.revision);
  p = a.store.confirmSpec(p.id, p.revision);
  const w = a.workspaces.generate(p);
  p = a.store.attachWorkspace(p.id, w, p.revision);
  const buildId = randomUUID(),
    checkId = randomUUID(),
    plan = JSON.parse(workspaceFiles(w)['GAME-TEST-PLAN.json']);
  // A labelled archive fixture exercises migration; real Minecraft evidence is in test:game.
  const bytes = zipFiles({ 'fabric.mod.json': Buffer.from(JSON.stringify({ id: example.modId })) });
  const artifactPath = join(a.builds.root, 'artifacts', buildId);
  mkdirSync(artifactPath, { recursive: true });
  writeFileSync(join(artifactPath, 'mod.jar'), bytes);
  const base = {
    projectId: p.id,
    snapshotHash: w.hash,
    status: 'passed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    log: 'unit migration fixture',
    targetId: w.targetId,
    template: w.template,
  };
  a.builds.records.write(buildId, {
    ...base,
    id: buildId,
    type: 'unit-fixture',
    artifact: { name: 'fixture.jar', format: 'jar', size: bytes.length, sha256: sha256(bytes) },
  });
  const report = Buffer.from(
    plan.cases.map((c) => JSON.stringify({ name: c.name, passed: true })).join('\n'),
  );
  const reportDir = join(a.builds.root, 'runs', checkId, 'workspace', 'build');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'minemod-game-tests.jsonl'), report);
  a.builds.records.write(checkId, {
    ...base,
    id: checkId,
    type: 'game-test',
    artifact: null,
    gameTested: true,
    tests: parseGameTestReceipt(report, plan),
  });
  const version = a.versions.capture(p.id);
  assert.deepEqual(version.buildIds, [buildId]);
  assert.equal(version.checks[0].id, checkId);
  const imported = b.backup.import(a.backup.export(p.id)),
    v = b.versions.list(imported.id)[0];
  assert.equal(v.imported, true);
  assert.notEqual(v.checks[0].id, checkId);
  const proof = b.builds.gameTestReport(v.checks[0].id);
  assert.deepEqual(proof.bytes, report);
  assert.equal(proof.record.gameTested, false);
  assert.equal(proof.record.externalValidation.locallyExecuted, false);
  assert.equal(b.versions.get(imported.id, v.id).checks[0].sha256, sha256(report));
});
