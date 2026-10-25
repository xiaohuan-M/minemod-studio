import { validateModel, exportBlockbench, importBlockbench } from './assets.mjs';
import { AppError } from './errors.mjs';
import { normalizeBones } from './skeleton.mjs';
import {
  hasSkeleton,
  exportSkeletonBlockbench,
  importSkeletonBlockbench,
  skeletonBedrockResources,
  animatorFrames,
} from './skeleton-exchange.mjs';
const fail = (message) => {
  throw new AppError(422, 'INVALID_ANIMATION', message);
};
const vector = (v, fallback, min, max) => {
  const out = v ?? fallback;
  if (
    !Array.isArray(out) ||
    out.length !== 3 ||
    out.some((n) => !Number.isFinite(n) || n < min || n > max)
  )
    fail('动画向量超出范围。');
  return [...out];
};
export function validateAnimation(input) {
  const { bones: inputBones, ...geometry } = input ?? {};
  const model = validateModel(geometry);
  let bones;
  if (inputBones !== undefined) {
    try {
      bones = normalizeBones(inputBones, model.elements.length);
    } catch (error) {
      fail(error.message);
    }
  }
  for (const element of model.elements) {
    element.rotation ??= { origin: [8, 8, 8], axis: 'x', angle: 0 };
    if (element.rotation.angle === 0) element.rotation.axis = 'x';
  }
  if (!Array.isArray(input.clips) || !input.clips.length || input.clips.length > 8)
    fail('动画素材需要 1–8 个片段。');
  const names = new Set();
  let total = 0;
  const clips = input.clips.map((clip) => {
    if (
      !clip ||
      typeof clip.name !== 'string' ||
      !/^[a-z][a-z0-9_]{0,47}$/.test(clip.name) ||
      names.has(clip.name)
    )
      fail('动画名称必须唯一，为小写字母、数字和下划线。');
    names.add(clip.name);
    if (
      !Number.isFinite(clip.duration) ||
      clip.duration < 0.1 ||
      clip.duration > 30 ||
      typeof clip.loop !== 'boolean' ||
      !Array.isArray(clip.tracks) ||
      clip.tracks.length > 128
    )
      fail('动画长度为 0.1–30 秒，轨道最多 128 条。');
    const elements = new Set();
    return {
      name: clip.name,
      duration: clip.duration,
      loop: clip.loop,
      tracks: clip.tracks.map((track) => {
        const target = bones ? track.bone : track.element;
        if (
          !Number.isInteger(target) ||
          target < 0 ||
          target >= (bones?.length ?? model.elements.length) ||
          (bones ? track.element !== undefined : track.bone !== undefined) ||
          elements.has(target) ||
          !Array.isArray(track.keyframes) ||
          !track.keyframes.length
        )
          fail('每个立方体最多一条轨道，且需要关键帧。');
        elements.add(target);
        const times = new Set();
        return {
          ...(bones ? { bone: target } : { element: target }),
          keyframes: track.keyframes
            .map((k) => {
              if (
                !Number.isFinite(k.time) ||
                k.time < 0 ||
                k.time > clip.duration ||
                times.has(k.time) ||
                ++total > 512
              )
                fail('关键帧时间必须唯一且在片段范围内，总数最多 512。');
              times.add(k.time);
              return {
                time: k.time,
                rotation: vector(k.rotation, [0, 0, 0], -360, 360),
                translation: vector(k.translation, [0, 0, 0], -80, 80),
                scale: vector(k.scale, [1, 1, 1], 0.01, 4),
              };
            })
            .sort((a, b) => a.time - b.time),
        };
      }),
    };
  });
  return { ...validateModel(model), ...(bones ? { bones } : {}), clips };
}
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
export function exportAnimatedBlockbench(input, name, texture) {
  const model = validateAnimation(input);
  if (model.bones) {
    try {
      return exportSkeletonBlockbench(model, name, texture);
    } catch (error) {
      fail(error.message);
    }
  }
  const base = exportBlockbench(model, name, texture);
  base.meta.model_format = 'bedrock';
  delete base.display;
  base.outliner = model.elements.map((e, i) => ({
    name: 'cube_' + i,
    origin: e.rotation?.origin ?? [8, 8, 8],
    uuid: uuid(1000 + i),
    children: [base.elements[i].uuid],
    visibility: true,
    export: true,
    rotation: [0, 0, 0],
  }));
  let key = 10000;
  base.animations = model.clips.map((clip, index) => {
    const animators = {};
    for (const track of clip.tracks) {
      const keyframes = [];
      for (const frame of track.keyframes) {
        for (const [channel, values] of [
          ['rotation', frame.rotation],
          ['position', frame.translation],
          ['scale', frame.scale],
        ]) {
          keyframes.push({
            uuid: uuid(key++),
            channel,
            time: frame.time,
            interpolation: 'linear',
            data_points: [{ x: String(values[0]), y: String(values[1]), z: String(values[2]) }],
          });
        }
      }
      animators[uuid(1000 + track.element)] = {
        name: 'cube_' + track.element,
        type: 'bone',
        keyframes,
      };
    }
    return {
      uuid: uuid(2000 + index),
      name: clip.name,
      loop: clip.loop ? 'loop' : 'once',
      length: clip.duration,
      override: false,
      snapping: 20,
      animators,
    };
  });
  return base;
}
export function importAnimatedBlockbench(input) {
  if (hasSkeleton(input)) {
    try {
      return validateAnimation(importSkeletonBlockbench(input));
    } catch (error) {
      fail(error.message);
    }
  }
  if (!Array.isArray(input?.outliner) || !input.outliner.length || !Array.isArray(input.animations))
    fail('需要包含立方体骨骼与动画的 bbmodel。');
  const groups = new Map();
  for (const g of input.outliner) {
    if (
      !g ||
      typeof g !== 'object' ||
      !Array.isArray(g.children) ||
      g.children.length !== 1 ||
      typeof g.children[0] !== 'string' ||
      g.rotation?.some((n) => n !== 0)
    )
      fail('当前交换支持每骨骼一个立方体的平面骨骼；请先在 Blockbench 拆分嵌套骨骼。');
    const index = input.elements.findIndex((e) => e.uuid === g.children[0]);
    if (index < 0) fail('骨骼引用缺失。');
    const origin = input.elements[index].origin ?? [8, 8, 8];
    if (JSON.stringify(g.origin ?? [8, 8, 8]) !== JSON.stringify(origin))
      fail('骨骼和立方体旋转中心需要一致。');
    groups.set(g.uuid, index);
  }
  if (
    groups.size !== input.elements.length ||
    new Set(groups.values()).size !== input.elements.length
  )
    fail('每个立方体需要唯一骨骼。');
  const model = importBlockbench({
    ...input,
    animations: [],
    groups: [],
    outliner: input.elements.map((e) => e.uuid),
  });
  for (const group of input.outliner) {
    const index = groups.get(group.uuid);
    model.elements[index].rotation ??= {
      origin: [...(group.origin ?? [8, 8, 8])],
      axis: 'x',
      angle: 0,
    };
  }
  const clips = input.animations.map((a) => ({
    name: a.name,
    duration: a.length,
    loop: a.loop === 'loop',
    tracks: Object.entries(a.animators ?? {}).map(([id, animator]) => {
      if (!groups.has(id)) fail('动画引用缺失的骨骼。');
      try {
        return { element: groups.get(id), keyframes: animatorFrames(animator) };
      } catch (error) {
        fail(error.message);
      }
    }),
  }));
  return validateAnimation({ ...model, clips });
}
/** Bedrock geometry + animation resource contracts. Each cube is a flat bone. */
export function bedrockAnimationResources(
  input,
  identifier,
  textureWidth = 64,
  textureHeight = 64,
) {
  const model = validateAnimation(input);
  if (model.bones) {
    try {
      return skeletonBedrockResources(model, identifier, textureWidth, textureHeight);
    } catch (error) {
      fail(error.message);
    }
  }
  const bones = model.elements.map((e, index) => {
    if (e.rotation?.rescale) fail('Bedrock 骨骼导出不支持 Java rescale，请先烘焙几何。');
    const faces = {};
    for (const [name, f] of Object.entries(e.faces)) {
      if (f === null) continue;
      if (f.rotation) fail('Bedrock 导出需先烘焙 UV 旋转。');
      const [a, b, c, d] = f.uv;
      faces[name] = {
        uv: [(a * textureWidth) / 16, (b * textureHeight) / 16],
        uv_size: [((c - a) * textureWidth) / 16, ((d - b) * textureHeight) / 16],
      };
    }
    return {
      name: 'cube_' + index,
      pivot: (e.rotation?.origin ?? [8, 8, 8]).map((v, i) => v - (i === 1 ? 0 : 8)),
      rotation: ['x', 'y', 'z'].map((axis) => (e.rotation?.axis === axis ? e.rotation.angle : 0)),
      cubes: [
        {
          origin: e.from.map((v, i) => v - (i === 1 ? 0 : 8)),
          size: e.to.map((v, i) => v - e.from[i]),
          uv: faces,
        },
      ],
    };
  });
  const animations = {};
  for (const clip of model.clips) {
    const animatedBones = {};
    for (const track of clip.tracks) {
      const channels = {};
      for (const [channel, field] of [
        ['rotation', 'rotation'],
        ['position', 'translation'],
        ['scale', 'scale'],
      ]) {
        channels[channel] = Object.fromEntries(
          track.keyframes.map((frame) => [String(frame.time), frame[field]]),
        );
      }
      animatedBones['cube_' + track.element] = channels;
    }
    animations['animation.' + identifier + '.' + clip.name] = {
      loop: clip.loop,
      animation_length: clip.duration,
      bones: animatedBones,
    };
  }
  return {
    geometry: {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: 'geometry.' + identifier,
            texture_width: textureWidth,
            texture_height: textureHeight,
            visible_bounds_width: 6,
            visible_bounds_height: 6,
            visible_bounds_offset: [0, 1, 0],
          },
          bones,
        },
      ],
    },
    animations: { format_version: '1.8.0', animations },
  };
}
export function defaultEntityAnimation(archetype = 'zombie') {
  const elements =
    archetype === 'cow'
      ? [
          { from: [3, 6, 2], to: [13, 16, 16] },
          { from: [4, 12, -4], to: [12, 20, 3] },
          ...[3, 10].flatMap((x) =>
            [3, 12].map((z) => ({ from: [x, 0, z], to: [x + 3, 7, z + 3] })),
          ),
        ]
      : [
          { from: [4, 10, 6], to: [12, 22, 10] },
          { from: [4, 22, 4], to: [12, 30, 12] },
          { from: [0, 10, 6], to: [4, 22, 10] },
          { from: [12, 10, 6], to: [16, 22, 10] },
          { from: [4, 0, 6], to: [8, 10, 10] },
          { from: [8, 0, 6], to: [12, 10, 10] },
        ];
  // Pivot per limb is encoded as a zero-angle bind rotation.
  elements.forEach((e) => {
    e.rotation = {
      origin: [(e.from[0] + e.to[0]) / 2, e.to[1], (e.from[2] + e.to[2]) / 2],
      axis: 'x',
      angle: 0,
    };
  });
  return validateAnimation({
    elements,
    clips: [
      {
        name: 'walk',
        duration: 1,
        loop: true,
        tracks: elements
          .map((_, i) => i)
          .filter((i) => i > 1)
          .map((i) => ({
            element: i,
            keyframes: [0, 0.5, 1].map((time, j) => ({
              time,
              rotation: [(j === 1 ? -1 : 1) * (i % 2 ? -25 : 25), 0, 0],
            })),
          })),
      },
    ],
  });
}
