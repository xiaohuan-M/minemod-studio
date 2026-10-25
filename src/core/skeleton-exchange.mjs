import { isSkeletonDocument, skeletonRadius } from './skeleton.mjs';
import { exportBlockbench, importBlockbench } from './assets.mjs';

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fail = (message) => {
  throw new Error(message);
};
const numeric = (value) => {
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value)))
    fail('骨骼动画只接受数值，不执行表达式。');
  return Number(value);
};

export const hasSkeleton = isSkeletonDocument;

export function exportSkeletonBlockbench(model, name, texture) {
  if (model.elements.some((e) => e.rotation?.rescale))
    fail('骨骼模型导出不支持 Java rescale，请先烘焙。');
  const base = exportBlockbench({ ...model, bones: undefined }, name, texture);
  base.meta.model_format = 'bedrock';
  delete base.display;
  base.minemod_skeleton = 1;
  base.minemod_bone_order = model.bones.map((_, i) => uuid(1000 + i));
  const groups = model.bones.map((bone, i) => ({
    name: bone.name,
    origin: bone.pivot,
    rotation: bone.rotation,
    uuid: uuid(1000 + i),
    children: bone.elements.map((index) => base.elements[index].uuid),
    visibility: true,
    export: true,
  }));
  model.bones.forEach((bone, i) => {
    if (bone.parent !== undefined) groups[bone.parent].children.push(groups[i]);
  });
  base.outliner = groups.filter((_, i) => model.bones[i].parent === undefined);
  let key = 10000;
  base.animations = model.clips.map((clip, index) => {
    const animators = {};
    for (const track of clip.tracks) {
      const keyframes = [];
      for (const frame of track.keyframes)
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
      animators[uuid(1000 + track.bone)] = {
        name: model.bones[track.bone].name,
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

export function animatorFrames(animator) {
  if (animator.type !== 'bone') fail('暂不支持效果器或声音轨道。');
  const channels = new Map([
      ['rotation', []],
      ['position', []],
      ['scale', []],
    ]),
    times = new Set();
  for (const key of animator.keyframes ?? []) {
    if (
      !channels.has(key.channel) ||
      key.interpolation !== 'linear' ||
      key.data_points?.length !== 1 ||
      !Number.isFinite(key.time)
    )
      fail('仅支持线性数值关键帧。');
    const values = ['x', 'y', 'z'].map((axis) => numeric(key.data_points[0][axis]));
    const list = channels.get(key.channel);
    if (list.some((frame) => frame.time === key.time)) fail('同一通道的关键帧时间不能重复。');
    list.push({ time: key.time, values });
    times.add(key.time);
    if (times.size > 512) fail('动画关键帧总数超过 512。');
  }
  for (const list of channels.values()) list.sort((a, b) => a.time - b.time);
  const sample = (list, time, fallback) => {
    if (!list.length) return fallback;
    let a = list[0],
      b = list.at(-1);
    for (const frame of list) {
      if (frame.time <= time) a = frame;
      if (frame.time >= time) {
        b = frame;
        break;
      }
    }
    const t = a.time === b.time ? 0 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    return a.values.map((v, i) => v + (b.values[i] - v) * t);
  };
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      rotation: sample(channels.get('rotation'), time, [0, 0, 0]),
      translation: sample(channels.get('position'), time, [0, 0, 0]),
      scale: sample(channels.get('scale'), time, [1, 1, 1]),
    }));
}

export function importSkeletonBlockbench(input) {
  if (
    !Array.isArray(input?.elements) ||
    !Array.isArray(input.outliner) ||
    (input.animations !== undefined && !Array.isArray(input.animations))
  )
    fail('骨骼模型缺少几何、层级或动画。');
  const cubes = new Map(),
    definitions = new Map(),
    bones = [],
    ids = new Map(),
    names = new Set(),
    used = new Set();
  input.elements.forEach((cube, index) => {
    if (
      typeof cube.uuid !== 'string' ||
      cubes.has(cube.uuid) ||
      (cube.type && cube.type !== 'cube')
    )
      fail('立方体 UUID 重复或不支持的网格。');
    cubes.set(cube.uuid, index);
  });
  for (const group of input.groups ?? []) {
    if (!group || typeof group.uuid !== 'string' || definitions.has(group.uuid))
      fail('骨骼 UUID 重复。');
    definitions.set(group.uuid, group);
  }
  const add = (node, parent, depth = 0) => {
    if (depth > 32 || bones.length >= 128) fail('骨骼层级或数量超出限制。');
    if (typeof node === 'string' && cubes.has(node)) {
      const element = cubes.get(node);
      if (used.has(element)) fail('立方体重复归属。');
      used.add(element);
      if (parent !== undefined) bones[parent].elements.push(element);
      else {
        const index = bones.length;
        const name = 'cube_' + element;
        if (names.has(name)) fail('骨骼名称重复。');
        names.add(name);
        bones.push({
          name,
          pivot: input.elements[element].origin ?? [8, 8, 8],
          rotation: [0, 0, 0],
          elements: [element],
        });
        ids.set('loose_' + index, index);
      }
      return;
    }
    const group =
      typeof node === 'string'
        ? definitions.get(node)
        : { ...(definitions.get(node?.uuid) ?? {}), ...node };
    if (
      !group ||
      typeof group !== 'object' ||
      typeof group.uuid !== 'string' ||
      cubes.has(group.uuid) ||
      ids.has(group.uuid) ||
      !Array.isArray(group.children)
    )
      fail('骨骼引用缺失、重复或循环。');
    const index = bones.length;
    if (
      typeof group.name !== 'string' ||
      !group.name.trim() ||
      group.name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(group.name) ||
      ['__proto__', 'prototype', 'constructor'].includes(group.name.trim()) ||
      names.has(group.name.trim())
    )
      fail('骨骼名称需要唯一且为 1–80 字，不含控制字符或保留键名。');
    names.add(group.name.trim());
    ids.set(group.uuid, index);
    bones.push({
      name: group.name.trim(),
      ...(parent !== undefined ? { parent } : {}),
      pivot: group.origin ?? [8, 8, 8],
      rotation: group.rotation ?? [0, 0, 0],
      elements: [],
    });
    for (const child of group.children) add(child, index, depth + 1);
  };
  for (const root of input.outliner) add(root, undefined);
  if (used.size !== input.elements.length) fail('模型存在未归属的立方体。');
  // Own exports retain the original index order; generic files use traversal order.
  if (input.minemod_bone_order) {
    const order = input.minemod_bone_order;
    if (
      !Array.isArray(order) ||
      order.length !== bones.length ||
      new Set(order).size !== bones.length ||
      order.some((id) => !ids.has(id))
    )
      fail('骨骼顺序元数据无效。');
    const oldToNew = new Map(order.map((id, index) => [ids.get(id), index])),
      sorted = order.map((id) => bones[ids.get(id)]);
    for (const bone of sorted)
      if (bone.parent !== undefined) bone.parent = oldToNew.get(bone.parent);
    bones.splice(0, bones.length, ...sorted);
    for (const [id, old] of ids) ids.set(id, oldToNew.get(old));
  }
  const elements = input.elements.map((cube, index) => {
    if (cube.rescale) fail('Bedrock 骨骼不支持 Java rescale，请先烘焙。');
    const rotation = cube.rotation ?? [0, 0, 0];
    if (
      !Array.isArray(rotation) ||
      rotation.length !== 3 ||
      rotation.some((n) => !Number.isFinite(n))
    )
      fail('立方体绑定旋转无效。');
    const nonzero = rotation.filter((n) => n !== 0);
    if (nonzero.length > 1 || nonzero.some((n) => ![-45, -22.5, 22.5, 45].includes(n))) {
      const parent = bones.findIndex((b) => b.elements.includes(index));
      bones[parent].elements = bones[parent].elements.filter((i) => i !== index);
      let name = 'cube_rotation_' + index;
      while (names.has(name)) name += 'x';
      names.add(name);
      bones.push({
        name,
        parent,
        pivot: cube.origin ?? [8, 8, 8],
        rotation: [...rotation],
        elements: [index],
      });
      return { ...cube, rotation: [0, 0, 0] };
    }
    return cube;
  });
  const geometry = importBlockbench({
    ...input,
    elements,
    groups: [],
    outliner: elements.map((e) => e.uuid),
    animations: [],
  });
  for (const [index, element] of geometry.elements.entries())
    if (!element.rotation && elements[index].origin)
      element.rotation = { origin: [...elements[index].origin], axis: 'x', angle: 0 };
  const sourceClips = input.animations?.length
    ? input.animations
    : [{ name: 'idle', length: 1, loop: 'loop', animators: {} }];
  const clips = sourceClips.map((animation) => ({
    name: animation.name,
    duration: animation.length,
    loop: animation.loop === 'loop',
    tracks: Object.entries(animation.animators ?? {})
      .map(([id, animator]) => {
        if (!ids.has(id)) fail('动画引用缺失的骨骼。');
        return { bone: ids.get(id), keyframes: animatorFrames(animator) };
      })
      .filter((track) => track.keyframes.length),
  }));
  return { ...geometry, bones, clips };
}

export function skeletonBedrockResources(model, identifier, textureWidth, textureHeight) {
  const radius = skeletonRadius(model);
  if (radius > 1024) fail('骨骼动画范围超出当前 Bedrock 导出上限，请缩小位移、缩放或层级。');
  const bounds = Math.max(6, Math.ceil(radius / 8));
  const cube = (element) => {
    if (element.rotation?.rescale) fail('Bedrock 不支持 Java rescale。');
    const uv = {};
    for (const [name, face] of Object.entries(element.faces)) {
      if (face === null) continue;
      if (face.rotation) fail('Bedrock 导出需先烘焙 UV 旋转。');
      const [a, b, c, d] = face.uv;
      uv[name] = {
        uv: [(a * textureWidth) / 16, (b * textureHeight) / 16],
        uv_size: [((c - a) * textureWidth) / 16, ((d - b) * textureHeight) / 16],
      };
    }
    return {
      origin: element.from.map((v, i) => v - (i === 1 ? 0 : 8)),
      size: element.to.map((v, i) => v - element.from[i]),
      uv,
      ...(element.rotation?.angle
        ? {
            pivot: element.rotation.origin.map((v, i) => v - (i === 1 ? 0 : 8)),
            rotation: ['x', 'y', 'z'].map((axis) =>
              axis === element.rotation.axis ? element.rotation.angle : 0,
            ),
          }
        : {}),
    };
  };
  const bones = model.bones.map((bone) => ({
    name: bone.name,
    ...(bone.parent !== undefined ? { parent: model.bones[bone.parent].name } : {}),
    pivot: bone.pivot.map((v, i) => v - (i === 1 ? 0 : 8)),
    rotation: bone.rotation,
    cubes: bone.elements.map((index) => cube(model.elements[index])),
  }));
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
      animatedBones[model.bones[track.bone].name] = channels;
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
            visible_bounds_width: bounds,
            visible_bounds_height: bounds,
            visible_bounds_offset: [0, 0, 0],
          },
          bones,
        },
      ],
    },
    animations: { format_version: '1.8.0', animations },
  };
}
