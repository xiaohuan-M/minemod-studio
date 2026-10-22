import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, assertProjectId } from '../src/core/project.mjs';
import { mockProvider } from '../src/providers/mock.mjs';

test('project validation rejects empty, oversized and unexpected fields', () => {
  for (const input of [
    null,
    [],
    { name: ' ', prompt: 'a' },
    { name: 'x', prompt: 'a'.repeat(4001) },
    { name: 'x', prompt: 'a', target: {} },
  ]) {
    assert.throws(() => createProject(input), { code: 'INVALID_INPUT' });
  }
});

test('offline planning preserves user intent and cannot claim compiled artifacts', () => {
  const project = createProject({ name: '  月光锤 ', prompt: '右键产生月光，冷却 3 秒。' });
  assert.equal(project.name, '月光锤');
  const plan = mockProvider.plan(project);
  assert.equal(plan.demo, true);
  assert.ok(plan.summary.includes(project.prompt));
  assert.equal(project.artifacts.length, 0);
  assert.equal(project.status, 'draft');
});

test('project ids cannot be filesystem paths', () => {
  for (const id of ['../outside', '/tmp/a', '..%2Fsecret', '123', undefined])
    assert.throws(() => assertProjectId(id), { code: 'INVALID_ID' });
});
