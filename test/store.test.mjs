import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { mockProvider } from '../src/providers/mock.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new ProjectStore(dir) };
}

test('projects and plans persist across store restarts', (t) => {
  const { dir, store } = fixture(t);
  const project = store.create({ name: '雷霆', prompt: '生成雷电武器' });
  store.plan(project.id, mockProvider);
  const restored = new ProjectStore(dir).get(project.id);
  assert.equal(restored.plan.demo, true);
  assert.equal(restored.status, 'planned');
  assert.deepEqual(restored.artifacts, []);
  assert.equal(store.list().length, 1);
});

test('corrupted records are reported and preserved', (t) => {
  const { dir, store } = fixture(t);
  const project = store.create({ name: 'x', prompt: 'y' });
  writeFileSync(join(dir, 'projects', `${project.id}.json`), 'broken json');
  assert.throws(() => store.get(project.id), { code: 'PROJECT_CORRUPT' });
});

test('symlink records are never followed', { skip: process.platform === 'win32' ? 'Windows symlink privileges vary; POSIX CI covers this case.' : false }, (t) => {
  const { dir, store } = fixture(t);
  const id = '12345678-1234-4234-8234-123456789abc';
  const outside = join(dir, 'outside.json');
  writeFileSync(outside, JSON.stringify({ schemaVersion: 1, id }));
  symlinkSync(outside, join(dir, 'projects', `${id}.json`));
  assert.throws(() => store.get(id), { code: 'INVALID_PROJECT_FILE' });
});

test('spec confirmation survives restart and older M0 records remain readable', (t) => {
  const {dir,store} = fixture(t);
  const project = store.create({name:'x',prompt:'y'});
  const generated = mockProvider.planSpec(project);
  let saved = store.setSpec(project.id, generated.spec, 0, generated.source);
  saved = store.confirmSpec(project.id, saved.revision);
  assert.deepEqual(new ProjectStore(dir).get(project.id), saved);
  const legacy = {...project};
  for (const key of ['revision','spec','specSource','specHash','confirmedSpecHash','specHistory']) delete legacy[key];
  writeFileSync(join(dir,'projects',project.id + '.json'), JSON.stringify(legacy));
  assert.equal(store.get(project.id).revision, 0);
  assert.equal(store.get(project.id).spec, null);
});

test('history restores exact specs, retains replaced version and requires fresh confirmation', t => {
  const {dir,store}=fixture(t);
  let project=store.create({name:'历史',prompt:'测试回滚'});
  const first=mockProvider.planSpec(project);
  project=store.setSpec(project.id,first.spec,project.revision,first.source);
  project=store.confirmSpec(project.id,project.revision);
  const original=structuredClone(project);
  const changed={...project.spec,displayName:'第二版'};
  project=store.setSpec(project.id,changed,project.revision);
  const history=store.history(project.id);
  assert.equal(history.length,1); assert.equal(history[0].confirmed,true);
  assert.equal('spec' in history[0],false);
  assert.deepEqual(store.snapshot(project.id,original.revision).spec,original.spec);
  const restored=store.restoreSpec(project.id,original.revision,project.revision);
  assert.deepEqual(restored.spec,original.spec);
  assert.equal(restored.confirmedSpecHash,null);
  assert.equal(restored.status,'awaiting_review');
  assert.equal(restored.specSource.restoredFromRevision,original.revision);
  assert.equal(store.snapshot(project.id,project.revision).spec.displayName,'第二版');
  assert.deepEqual(new ProjectStore(dir).get(project.id),restored);
  assert.throws(()=>store.restoreSpec(project.id,original.revision,project.revision),{code:'PROJECT_CHANGED'});
  assert.throws(()=>store.snapshot(project.id,9999),{code:'SNAPSHOT_NOT_FOUND'});
});

test('history is bounded, invalid edits do not add snapshots, and corrupt history is preserved', t => {
  const {dir,store}=fixture(t);
  let project=store.create({name:'历史上限',prompt:'版本'});
  const {spec}=mockProvider.planSpec(project);
  for(let i=0;i<25;i++) project=store.setSpec(project.id,{...spec,displayName:'版本'+i},project.revision);
  assert.equal(store.history(project.id).length,20);
  assert.throws(()=>store.snapshot(project.id,1),{code:'SNAPSHOT_NOT_FOUND'});
  assert.throws(()=>store.setSpec(project.id,{...spec,command:'no'},project.revision),{code:'INVALID_SPEC'});
  assert.deepEqual(store.get(project.id),project);
  project.specHistory[0].spec.displayName='篡改历史';
  const file=join(dir,'projects',project.id+'.json');
  const raw=JSON.stringify(project);writeFileSync(file,raw);
  assert.throws(()=>store.get(project.id),{code:'PROJECT_CORRUPT'});
});
