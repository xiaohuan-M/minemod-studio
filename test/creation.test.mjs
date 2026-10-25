import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { makeServer } from '../src/server.mjs';
import { CreationManager } from '../src/creation/manager.mjs';
import { ProjectStore } from '../src/storage/project-store.mjs';
import { AppError } from '../src/core/errors.mjs';
import { placeholderTexture, pngTexture, exportBlockbench } from '../src/core/assets.mjs';
import { readZipEntry } from '../src/core/archive.mjs';
import example from '../examples/project-spec.json' with { type: 'json' };
import fullWorkshop from '../examples/full-workshop.json' with { type: 'json' };
import rig from '../examples/rigged-guardian.json' with { type: 'json' };

test('appearance revisions edit existing assets, keep unrelated bindings, compose texture-only changes and preserve old deliveries', async (t) => {
  const provider = fixtureProvider(),
    calls = [];
  provider.planSpec = async (project) => {
    const spec = structuredClone(project.spec ?? fullWorkshop);
    spec.target = { ...project.target };
    spec.items = spec.items.filter((i) => ['basic_item', 'food'].includes(i.kind));
    if (project.instruction === 'redraw') {
      spec.blocks[0].texturePrompt = '红色斑纹';
      spec.blocks[0].modelPrompt = '增高到 12 像素';
    }
    if (project.instruction === 'blue') {
      spec.blocks[0].texturePrompt = '蓝色斑纹';
    }
    if (project.instruction === 'rename') spec.blocks[0].displayName.zh_cn = '只改名称';
    return { spec, source };
  };
  provider.planAsset = async (input) => {
    calls.push(structuredClone(input));
    return {
      kind: input.kind,
      data:
        input.kind === 'texture'
          ? placeholderTexture(
              input.prompt.includes('蓝色斑纹')
                ? '#0000ff'
                : input.prompt.includes('红色斑纹')
                  ? '#ff0000'
                  : '#00ff00',
            )
          : {
              elements: [
                { from: [0, 0, 0], to: [8, input.prompt.includes('增高到 12') ? 12 : 8, 8] },
              ],
            },
      source,
    };
  };
  const { server, call } = await fixture(t, provider);
  const response = await call('/api/creations', 'POST', {
    prompt: '完整的工坊',
    targetId: 'bedrock-1.21.60',
    ...approved,
    maxCalls: 64,
  });
  const { project, task: queued } = await response.json(),
    first = await finished(server, queued.id);
  assert.equal(first.status, 'passed', JSON.stringify(first.error));
  const initial = server.workshop.creations.current(first),
    oldArtifact = server.workshop.builds.artifact(first.buildId).bytes;
  async function revise(instruction, extra = {}) {
    calls.length = 0;
    const p = server.workshop.creations.store.get(project.id);
    const response = await call('/api/projects/' + p.id + '/creations', 'POST', {
      revision: p.revision,
      instruction,
      ...approved,
      maxCalls: 64,
      ...extra,
    });
    assert.equal(response.status, 202, await response.clone().text());
    const task = await finished(server, (await response.json()).id);
    assert.equal(task.status, 'passed', JSON.stringify(task.error));
    return { task, p: server.workshop.creations.current(task) };
  }
  const red = await revise('redraw');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.currentData));
  assert.deepEqual(red.p.spec.items, initial.spec.items);
  assert.deepEqual(red.p.spec.entities, initial.spec.entities);
  const redBlock = red.p.spec.blocks[0],
    redModel = server.workshop.assets.get(redBlock.modelAsset);
  assert.equal(redModel.data.elements[0].to[1], 12);
  assert.ok(redModel.derivedFrom.some((o) => o.id === initial.spec.blocks[0].modelAsset));
  const blue = await revise('blue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'texture');
  const blueBlock = blue.p.spec.blocks[0],
    blueModel = server.workshop.assets.get(blueBlock.modelAsset),
    blueTexture = server.workshop.assets.get(blueBlock.textureAsset);
  assert.deepEqual(blueModel.data.elements, redModel.data.elements);
  assert.deepEqual(blueModel.data.texture, blueTexture.data);
  assert.ok(
    exportBlockbench(blueModel.data).textures[0].source.endsWith(
      pngTexture(blueTexture.data).toString('base64'),
    ),
  );
  const pack = readZipEntry(
    server.workshop.builds.artifact(blue.task.buildId).bytes,
    'resource_pack.mcpack',
  );
  assert.deepEqual(
    readZipEntry(pack, 'textures/blocks/full_workshop_glow_block.png'),
    pngTexture(blueTexture.data),
  );
  await revise('rename');
  assert.equal(calls.length, 0);
  await revise('', { refreshMaterials: true });
  assert.ok(calls.length > 2);
  assert.ok(calls.every((c) => c.currentData));
  assert.deepEqual(server.workshop.builds.artifact(first.buildId).bytes, oldArtifact);
});

const source = {
  provider: 'test-fixture',
  model: 'local-fixture',
  demo: true,
  usage: { inputTokens: 12, outputTokens: 20 },
};
export function fixtureProvider() {
  return {
    info: {
      configured: true,
      model: 'local-fixture',
      baseUrl: 'http://127.0.0.1:9/v1/',
      configurationId: 'test-creation-consent',
    },
    async planSpec(project) {
      const spec = structuredClone(project.spec ?? example);
      spec.target = { ...project.target };
      spec.displayName = project.name;
      return { spec, source };
    },
    async planAsset({ kind }) {
      return {
        kind,
        data:
          kind === 'texture'
            ? placeholderTexture()
            : { elements: [{ from: [3, 1, 3], to: [13, 15, 13] }] },
        source,
      };
    },
  };
}
async function fixture(t, provider = fixtureProvider()) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-creation-')),
    server = makeServer({ dataDir: dir, llmProvider: provider });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.workshop.creations.close();
    await server.workshop.builds.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, method = 'GET', data) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  return { server, call, dir };
}
const approved = {
  approved: true,
  consent: 'test-creation-consent',
  allowNetwork: false,
  maxCalls: 12,
};
async function finished(server, id) {
  for (let i = 0; i < 200; i++) {
    const task = server.workshop.creations.get(id);
    if (!['queued', 'running'].includes(task.status)) return task;
    await delay(10);
  }
  throw new Error('Creation did not finish');
}
test('one sentence runs assets, source, real Bedrock packaging and complete round preservation over HTTP', async (t) => {
  const { server, call } = await fixture(t);
  const response = await call('/api/creations', 'POST', {
    prompt: '制作一颗晶体和合成配方',
    targetId: 'bedrock-1.21.60',
    ...approved,
  });
  assert.equal(response.status, 202);
  const { project, task: queued } = await response.json(),
    task = await finished(server, queued.id);
  assert.equal(task.status, 'passed', JSON.stringify(task.error));
  assert.ok(task.assetJobs.length > 0);
  assert.ok(task.calls.every((c) => c.status === 'passed' && c.usage.inputTokens === 12));
  assert.deepEqual(
    task.events.map((e) => e.seq),
    task.events.map((_, i) => i + 1),
  );
  const saved = await (await call('/api/projects/' + project.id)).json();
  assert.ok(saved.spec.items.every((i) => i.textureAsset));
  const artifact = Buffer.from(
    await (await call('/api/builds/' + task.buildId + '/artifact')).arrayBuffer(),
  );
  readZipEntry(readZipEntry(artifact, 'behavior_pack.mcpack'), 'manifest.json');
  const version = server.workshop.versions.get(project.id, task.versionId);
  assert.equal(version.workspaceHash, task.snapshotHash);
  assert.deepEqual(version.buildIds, [task.buildId]);
  const nextResponse = await call('/api/projects/' + project.id + '/creations', 'POST', {
    revision: saved.revision,
    instruction: '继续完善',
    ...approved,
  });
  assert.equal(nextResponse.status, 202);
  const next = await finished(server, (await nextResponse.json()).id);
  assert.equal(next.status, 'passed');
  assert.ok(server.workshop.versions.list(project.id).length >= 2);
  const old = Buffer.from(
    await (await call('/api/builds/' + task.buildId + '/artifact')).arrayBuffer(),
  );
  assert.deepEqual(old, artifact);
});

test('one prompt automatically installs a real hierarchical animated Bedrock entity instead of replacing its clips with idle', async (t) => {
  const provider = fixtureProvider(),
    asset = provider.planAsset;
  provider.planSpec = async (project) => {
    const spec = structuredClone(fullWorkshop);
    spec.target = { ...project.target };
    spec.items = spec.items.filter((i) => ['basic_item', 'food'].includes(i.kind));
    return { spec, source };
  };
  provider.planAsset = async (input) =>
    input.kind === 'animated_model'
      ? { kind: input.kind, data: structuredClone(rig), source }
      : asset(input);
  const { server, call } = await fixture(t, provider),
    response = await call('/api/creations', 'POST', {
      prompt: '制作带父子骨骼和挥手动作的生物',
      targetId: 'bedrock-1.21.60',
      ...approved,
      maxCalls: 64,
    });
  assert.equal(response.status, 202);
  const task = await finished(server, (await response.json()).task.id);
  assert.equal(task.status, 'passed', JSON.stringify(task.error));
  const project = server.workshop.creations.current(task),
    entity = project.spec.entities[0],
    model = server.workshop.assets.get(entity.modelAsset);
  assert.equal(model.kind, 'animated_model');
  assert.equal(model.data.bones.length, 3);
  assert.equal(entity.animationClip, 'wave');
  assert.equal(model.data.clips[0].tracks[0].bone, 2);
  const pack = server.workshop.builds.artifact(task.buildId).bytes,
    resources = readZipEntry(pack, 'resource_pack.mcpack'),
    geometry = JSON.parse(readZipEntry(resources, 'models/entity/' + entity.id + '.geo.json'))[
      'minecraft:geometry'
    ][0];
  assert.equal(geometry.bones[2].parent, '身体');
  assert.equal(geometry.bones[0].cubes.length, 2);
});

test('active creation blocks conflicting project/provider writes; cancellation and resume retain completed work', async (t) => {
  const provider = fixtureProvider(),
    original = provider.planAsset;
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  provider.planAsset = async (input, { signal }) => {
    enter();
    await delay(60000, undefined, { signal });
    return original(input);
  };
  const { server, call } = await fixture(t, provider);
  const { project, task } = await (
    await call('/api/creations', 'POST', {
      prompt: '可取消作品',
      targetId: 'bedrock-1.21.60',
      ...approved,
    })
  ).json();
  await entered;
  const p = await (await call('/api/projects/' + project.id)).json();
  assert.equal(
    (await call('/api/projects/' + p.id + '/spec', 'PUT', { revision: p.revision, spec: p.spec }))
      .status,
    409,
  );
  assert.equal(
    (await call('/api/settings/providers', 'POST', { revision: 0, profile: {} })).status,
    409,
  );
  assert.equal((await call('/api/creations/' + task.id + '/cancel', 'POST', {})).status, 200);
  assert.equal((await finished(server, task.id)).status, 'cancelled');
  provider.planAsset = original;
  const resumed = await call('/api/creations/' + task.id + '/resume', 'POST', {
    ...approved,
    textures: false,
    revision: server.workshop.creations.get(task.id).expectedRevision,
  });
  // Resume may extend budget/network grants, but cannot silently change which assets are required.
  assert.equal(resumed.status, 400);
  assert.equal(
    (
      await call('/api/creations/' + task.id + '/resume', 'POST', {
        approved: true,
        consent: approved.consent,
        revision: server.workshop.creations.get(task.id).expectedRevision,
      })
    ).status,
    202,
  );
  const done = await finished(server, task.id);
  assert.equal(done.status, 'passed');
  assert.equal(done.calls.filter((c) => c.method === 'planSpec').length, 1);
});

test('model-call budgets stop before extra calls; no approval or stale consent cannot start work', async (t) => {
  const { server, call } = await fixture(t);
  assert.equal(
    (await call('/api/creations', 'POST', { prompt: '未授权', ...approved, approved: false }))
      .status,
    400,
  );
  assert.equal(
    (await call('/api/creations', 'POST', { prompt: '旧配置', ...approved, consent: 'old' }))
      .status,
    400,
  );
  const { task } = await (
    await call('/api/creations', 'POST', {
      prompt: '预算限制',
      targetId: 'bedrock-1.21.60',
      ...approved,
      maxCalls: 1,
    })
  ).json();
  const result = await finished(server, task.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'CREATION_BUDGET');
  assert.equal(result.calls.length, 1);
  assert.equal(result.buildId, null);
  assert.equal(
    (
      await call('/api/creations/' + task.id + '/resume', 'POST', {
        approved: true,
        consent: approved.consent,
        revision: result.expectedRevision,
        maxCalls: 12,
      })
    ).status,
    202,
  );
  const resumed = await finished(server, task.id);
  assert.equal(resumed.status, 'passed');
  assert.equal(resumed.calls.filter((c) => c.method === 'planSpec').length, 1);
});

test('restart marks unfinished records interrupted and resumes from the saved project without repeating planning', async (t) => {
  const provider = fixtureProvider(),
    { server, call, dir } = await fixture(t, provider);
  const { task } = await (
    await call('/api/creations', 'POST', {
      prompt: '重启恢复',
      targetId: 'bedrock-1.21.60',
      ...approved,
      textures: false,
      models: false,
    })
  ).json();
  const completed = await finished(server, task.id);
  // Simulate a crash after the persisted successful build, before the final task event.
  completed.status = 'running';
  completed.versionId = null;
  server.workshop.creations.records.write(task.id, completed);
  const restored = new CreationManager(dir, new ProjectStore(dir), server.workshop);
  assert.equal(restored.get(task.id).status, 'interrupted');
  restored.resume(task.id, { revision: completed.expectedRevision, approved: true }, provider);
  for (let i = 0; i < 100 && restored.active.size; i++) await delay(10);
  const resumed = restored.get(task.id);
  assert.equal(resumed.status, 'passed');
  assert.equal(resumed.calls.length, completed.calls.length);
  assert.equal(resumed.buildId, completed.buildId);
});

test('invalid specifications consume bounded repair attempts and only a validated pack is delivered', async (t) => {
  const provider = fixtureProvider(),
    original = provider.planSpec;
  let attempts = 0;
  provider.planSpec = async (project) => {
    if (++attempts === 1) throw new AppError(422, 'PROVIDER_INVALID_SPEC', '规格校验失败');
    return original(project);
  };
  const { server, call } = await fixture(t, provider);
  const { task } = await (
    await call('/api/creations', 'POST', {
      prompt: '有限修复',
      targetId: 'bedrock-1.21.60',
      ...approved,
      textures: false,
      models: false,
    })
  ).json();
  const done = await finished(server, task.id);
  assert.equal(done.status, 'passed');
  assert.equal(done.repairs, 1);
  assert.equal(done.calls.length, 2);
  assert.ok(done.events.some((e) => e.stage === 'repairing'));
});
