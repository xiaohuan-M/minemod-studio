import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  validateAnimation,
  defaultEntityAnimation,
  exportAnimatedBlockbench,
  importAnimatedBlockbench,
  bedrockAnimationResources,
} from '../src/core/animation.mjs';
import { sampleClip } from '../web/studio/animation-timeline.js';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { validateModSpec } from '../src/core/mod-spec.mjs';
import specFixture from '../examples/project-spec.json' with { type: 'json' };
test('flat bone animation validates bounds, interpolates linearly and survives animated bbmodel roundtrip', () => {
  const model = defaultEntityAnimation('zombie'),
    bb = exportAnimatedBlockbench(model, 'walk');
  assert.equal(bb.meta.model_format, 'bedrock');
  const plain = validateAnimation({
    elements: [{ from: [0, 0, 0], to: [8, 8, 8] }],
    clips: [{ name: 'idle', duration: 1, loop: true, tracks: [] }],
  });
  assert.equal(
    JSON.stringify(validateAnimation(plain)),
    JSON.stringify(plain),
    'revalidation must preserve the exact stored hash representation',
  );
  assert.deepEqual(importAnimatedBlockbench(bb), model);
  const pose = sampleClip(model.clips[0], 0.25);
  assert.equal(pose[2].rotation[0], 0);
  assert.deepEqual(pose[2].scale, [1, 1, 1]);
  const duplicate = structuredClone(model);
  duplicate.clips[0].tracks[0].keyframes.push({ ...duplicate.clips[0].tracks[0].keyframes[0] });
  assert.throws(() => validateAnimation(duplicate), /时间/);
  const expression = structuredClone(bb);
  Object.values(expression.animations[0].animators)[0].keyframes[0].data_points[0].x =
    'query.life_time';
  assert.throws(() => importAnimatedBlockbench(expression), /表达式/);
  const geometry = bedrockAnimationResources(model, 'sample.guard', 64, 64);
  assert.equal(geometry.geometry['minecraft:geometry'][0].bones.length, 6);
  assert.ok(geometry.animations.animations['animation.sample.guard.walk']);
});
test('Bedrock custom animated entities bind geometry, clips, textures and behavior while Java refuses unsupported bindings', () => {
  const spec = structuredClone(specFixture);
  spec.target = { edition: 'bedrock', loader: 'bedrock', minecraft: '1.21.60', java: 0 };
  const asset = {
    id: randomUUID(),
    kind: 'animated_model',
    name: '步行动画',
    data: defaultEntityAnimation('cow'),
    source: '原创',
    license: 'CC0',
  };
  spec.entities = [
    {
      id: 'test_cow',
      displayName: { zh_cn: '测试牛', en_us: 'Test Cow' },
      archetype: 'cow',
      health: 10,
      movementSpeed: 0.2,
      attackDamage: 0,
      modelAsset: asset.id,
      animationClip: 'walk',
    },
  ];
  const w = generateWorkspace(spec, [asset]),
    files = workspaceFiles(w);
  assert.ok(w.assetIds.includes(asset.id));
  const behavior = JSON.parse(files['behavior_pack/entities/test_cow.json']);
  assert.equal(behavior['minecraft:entity'].components['minecraft:health'].max, 10);
  const client = JSON.parse(files['resource_pack/entity/test_cow.entity.json'])[
    'minecraft:client_entity'
  ].description;
  assert.equal(client.geometry.default, 'geometry.' + spec.modId + '.test_cow');
  assert.equal(client.scripts.animate[0].walk, 'query.modified_move_speed > 0.01');
  assert.ok(files['resource_pack/models/entity/test_cow.geo.json']);
  assert.ok(files['resource_pack/animations/test_cow.animation.json']);
  const bad = structuredClone(spec);
  bad.entities[0].animationClip = 'missing';
  assert.throws(() => generateWorkspace(bad, [asset]), /片段不存在/);
  spec.target = { edition: 'java', loader: 'fabric', minecraft: '1.21.1', java: 21 };
  assert.throws(() => validateModSpec(spec), /只接入 Bedrock/);
});
