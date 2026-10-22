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
  for (const key of ['revision','spec','specSource','specHash','confirmedSpecHash']) delete legacy[key];
  writeFileSync(join(dir,'projects',project.id + '.json'), JSON.stringify(legacy));
  assert.equal(store.get(project.id).revision, 0);
  assert.equal(store.get(project.id).spec, null);
});
