// Explicit Docker integration: model outputs are a labelled local fixture; compilation is real.
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.mjs';
import { getTarget } from '../src/core/targets.ts';
import { placeholderTexture } from '../src/core/assets.mjs';
import { readZipEntry, sha256 } from '../src/core/archive.mjs';
import example from '../examples/full-workshop.json' with { type: 'json' };

const targetId = process.env.MINEMOD_TEST_TARGET ?? 'fabric-1.21.1';
assert.ok(getTarget(targetId)?.target.edition === 'java');
const parent = resolve('.minemod');
mkdirSync(parent, { recursive: true });
const dir = mkdtempSync(join(parent, 'creation-validation-'));
if (process.env.MINEMOD_TEST_GRADLE_CACHE) {
  mkdirSync(join(dir, 'builds'), { recursive: true });
  cpSync(resolve(process.env.MINEMOD_TEST_GRADLE_CACHE), join(dir, 'builds', 'cache'), {
    recursive: true,
  });
}
const source = { provider: 'integration-fixture', model: 'fixed-integration-output', demo: true };
const server = makeServer({
  dataDir: dir,
  llmProvider: {
    info: { configured: true, model: source.model, configurationId: 'integration-creation' },
    async planSpec(project) {
      const spec = structuredClone(example);
      spec.target = project.target;
      return { spec, source };
    },
    async planAsset({ kind }) {
      return {
        kind,
        source,
        data:
          kind === 'texture'
            ? placeholderTexture()
            : { elements: [{ from: [3, 0, 3], to: [13, 16, 13] }] },
      };
    },
  },
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const response = await fetch(base + '/api/creations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '完整样例的自动素材与真实 Java 编译',
      targetId,
      approved: true,
      consent: 'integration-creation',
      allowNetwork: true,
      maxCalls: 64,
    }),
  });
  assert.equal(response.status, 202, await response.clone().text());
  const queued = await response.json();
  let task,
    last = '';
  for (;;) {
    task = server.workshop.creations.get(queued.task.id);
    if (task.stage !== last) {
      console.log('creation', task.stage);
      last = task.stage;
    }
    if (!['queued', 'running'].includes(task.status)) break;
    await delay(500);
  }
  assert.equal(
    task.status,
    'passed',
    JSON.stringify(task.error) +
      '\n' +
      (task.buildId ? server.workshop.builds.get(task.buildId).log : ''),
  );
  const build = server.workshop.builds.get(task.buildId),
    artifact = server.workshop.builds.artifact(task.buildId).bytes;
  readZipEntry(artifact, 'studio/minemod/generated/m_full_workshop/GeneratedMod.class');
  readZipEntry(artifact, 'assets/full_workshop/textures/entity/crystal_guard.png');
  const version = server.workshop.versions.get(task.projectId, task.versionId);
  assert.equal(version.workspaceHash, task.snapshotHash);
  assert.deepEqual(version.buildIds, [task.buildId]);
  assert.equal(build.artifact.sha256, sha256(artifact));
  const result = {
    result: 'passed',
    data: relative(process.cwd(), dir),
    targetId,
    taskId: task.id,
    snapshot: task.snapshotHash,
    versionId: task.versionId,
    generatedAssets: task.assetJobs.length,
    modelCalls: task.calls.length,
    modelFixture: true,
    artifact: build.artifact,
    gameTested: false,
  };
  writeFileSync(join(dir, 'CREATION-VALIDATION.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
