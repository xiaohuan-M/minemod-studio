import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAnimation,
  exportAnimatedBlockbench,
  importAnimatedBlockbench,
  bedrockAnimationResources,
} from '../src/core/animation.mjs';
import {
  normalizeBones,
  withSkeleton,
  removeBone,
  isSkeletonDocument,
  skeletonRadius,
} from '../src/core/skeleton.mjs';
import { validateModel } from '../src/core/assets.mjs';
import { sha256 } from '../src/core/archive.mjs';
import { sampleClip } from '../web/studio/animation-timeline.js';

export function rigFixture() {
  return validateAnimation({
    elements: [
      { from: [4, 4, 4], to: [12, 12, 12] },
      { from: [4, 12, 4], to: [12, 16, 12] },
      { from: [12, 8, 6], to: [16, 12, 10] },
    ],
    bones: [
      { name: '身体', pivot: [8, 8, 8], rotation: [0, 20, 0], elements: [0, 1] },
      { name: '另一根', pivot: [8, 8, 8], elements: [] },
      { name: '右手', parent: 0, pivot: [12, 10, 8], rotation: [15, 0, 25], elements: [2] },
    ],
    clips: [
      {
        name: 'wave',
        duration: 1,
        loop: true,
        tracks: [
          {
            bone: 2,
            keyframes: [{ time: 0 }, { time: 1, rotation: [0, 0, 60], translation: [0, 2, 0] }],
          },
        ],
      },
    ],
  });
}

test('hierarchical rigs preserve ownership, parents, multi-axis binds, animation and canonical hashes through bbmodel and Bedrock', () => {
  const model = rigFixture();
  assert.equal(sha256(JSON.stringify(validateAnimation(model))), sha256(JSON.stringify(model)));
  const exported = exportAnimatedBlockbench(model, '层级角色');
  assert.equal(exported.outliner.length, 2);
  assert.equal(exported.outliner[0].children.length, 3);
  assert.deepEqual(exported.outliner[0].children[2].rotation, [15, 0, 25]);
  assert.deepEqual(importAnimatedBlockbench(exported), model);
  const resources = bedrockAnimationResources(model, 'test.character', 16, 16),
    bones = resources.geometry['minecraft:geometry'][0].bones;
  assert.equal(bones[0].cubes.length, 2);
  assert.equal(bones[2].parent, '身体');
  assert.deepEqual(bones[2].rotation, [15, 0, 25]);
  assert.deepEqual(
    resources.animations.animations['animation.test.character.wave'].bones['右手'].rotation['1'],
    [0, 0, 60],
  );
  assert.deepEqual(sampleClip(model.clips[0], 0.5)[2].rotation, [0, 0, 30]);
  assert.throws(() => validateModel(model), { code: 'INVALID_ASSET' });
});

test('skeleton validation rejects cycles, duplicate or missing ownership, mixed tracks and unsafe names; old rigs stay unchanged until conversion', () => {
  const model = rigFixture();
  for (const change of [
    (m) => (m.bones[0].parent = 2),
    (m) => m.bones[1].elements.push(0),
    (m) => m.bones[0].elements.pop(),
    (m) => (m.bones[0].name = '__proto__'),
    (m) => (m.clips[0].tracks[0].element = 1),
  ]) {
    const broken = structuredClone(model);
    change(broken);
    assert.throws(() => validateAnimation(broken), { code: 'INVALID_ANIMATION' });
  }
  const old = validateAnimation({
    elements: [{ from: [0, 0, 0], to: [8, 8, 8] }],
    clips: [
      { name: 'idle', duration: 1, loop: true, tracks: [{ element: 0, keyframes: [{ time: 0 }] }] },
    ],
  });
  assert.equal(Object.hasOwn(old, 'bones'), false);
  const converted = withSkeleton(old);
  assert.equal(converted.clips[0].tracks[0].bone, 0);
  assert.ok(validateAnimation(converted).bones);
  assert.equal(old.clips[0].tracks[0].element, 0);
  const removed = removeBone(model, 1);
  assert.equal(removed.bones[1].name, '右手');
  assert.equal(removed.clips[0].tracks[0].bone, 1);
  assert.throws(() => removeBone(model, 0));
  assert.deepEqual(normalizeBones(model.bones, 3), model.bones);
});

test('generic nested Blockbench imports promote arbitrary cube Euler rotation and interpolate independent channel times', () => {
  const exported = exportAnimatedBlockbench(rigFixture(), 'external');
  delete exported.minemod_skeleton;
  delete exported.minemod_bone_order;
  exported.elements[2].rotation = [12, 30, 45];
  const boneId = exported.outliner[0].children[2].uuid;
  exported.animations[0].animators[boneId].keyframes = [
    {
      channel: 'rotation',
      time: 0,
      interpolation: 'linear',
      data_points: [{ x: '0', y: '0', z: '0' }],
    },
    {
      channel: 'rotation',
      time: 1,
      interpolation: 'linear',
      data_points: [{ x: '0', y: '0', z: '60' }],
    },
    {
      channel: 'position',
      time: 0.5,
      interpolation: 'linear',
      data_points: [{ x: '0', y: '2', z: '0' }],
    },
  ];
  const imported = importAnimatedBlockbench(exported);
  assert.equal(imported.bones.length, 4);
  assert.deepEqual(imported.bones.at(-1).rotation, [12, 30, 45]);
  const track = imported.clips[0].tracks[0];
  assert.deepEqual(track.keyframes[1].rotation, [0, 0, 30]);
  assert.deepEqual(track.keyframes[0].translation, [0, 2, 0]);
});

test('static skeletons and noncentral cube pivots roundtrip without losing bind data; malformed documents fail predictably', () => {
  const flat = validateAnimation({
    elements: [
      { from: [0, 0, 0], to: [8, 8, 8], rotation: { origin: [2, 4, 6], axis: 'y', angle: 45 } },
    ],
    clips: [{ name: 'idle', duration: 1, loop: true, tracks: [] }],
  });
  const converted = validateAnimation(withSkeleton(flat));
  assert.deepEqual(
    importAnimatedBlockbench(exportAnimatedBlockbench(converted, 'pivot')),
    converted,
  );
  const staticRig = exportAnimatedBlockbench(rigFixture(), 'static');
  delete staticRig.animations;
  assert.equal(importAnimatedBlockbench(staticRig).clips[0].name, 'idle');
  assert.equal(isSkeletonDocument({ outliner: 'invalid', elements: {} }), false);
  assert.throws(() => importAnimatedBlockbench({ outliner: 'invalid' }), {
    code: 'INVALID_ANIMATION',
  });
  const duplicate = exportAnimatedBlockbench(rigFixture(), 'duplicate');
  duplicate.outliner[0].uuid = duplicate.elements[0].uuid;
  delete duplicate.minemod_bone_order;
  assert.throws(() => importAnimatedBlockbench(duplicate), { code: 'INVALID_ANIMATION' });
  const expression = exportAnimatedBlockbench(rigFixture(), 'expression');
  Object.values(expression.animations[0].animators)[0].keyframes[0].data_points[0].x =
    'query.life_time';
  assert.throws(() => importAnimatedBlockbench(expression), { code: 'INVALID_ANIMATION' });
});

test('Bedrock culling bounds include animated hierarchies and reject excessive accumulated transforms', () => {
  const model = rigFixture();
  model.clips[0].tracks[0].keyframes[1].translation = [80, 80, 80];
  model.clips[0].tracks[0].keyframes[1].scale = [4, 4, 4];
  const resources = bedrockAnimationResources(model, 'bounds', 16, 16),
    description = resources.geometry['minecraft:geometry'][0].description;
  assert.ok(description.visible_bounds_width >= skeletonRadius(model) / 8);
  assert.ok(description.visible_bounds_width > 6);
  assert.deepEqual(description.visible_bounds_offset, [0, 0, 0]);
  model.bones = Array.from({ length: 9 }, (_, i) => ({
    name: 'bone_' + i,
    ...(i ? { parent: i - 1 } : {}),
    pivot: [8, 8, 8],
    rotation: [0, 0, 0],
    elements: i === 8 ? [0, 1, 2] : [],
  }));
  model.clips[0].tracks = model.bones.map((_, bone) => ({
    bone,
    keyframes: [{ time: 0, scale: [4, 4, 4] }],
  }));
  assert.throws(() => bedrockAnimationResources(model, 'large', 16, 16), {
    code: 'INVALID_ANIMATION',
  });
});
