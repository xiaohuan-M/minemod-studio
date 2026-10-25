// Pure skeleton contract shared by domain validation and the browser editor.
// Pivots use model pixels in world bind space; rotations use degrees, ZYX order.
export function normalizeBones(input, elementCount) {
  const fail = (message) => {
    throw new Error(message);
  };
  if (!Array.isArray(input) || !input.length || input.length > 128) fail('骨骼需要 1–128 个分组。');
  const names = new Set(),
    owners = new Set();
  const vector = (value, fallback, min, max) => {
    const v = value ?? fallback;
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      v.some((n) => !Number.isFinite(n) || n < min || n > max)
    )
      fail('骨骼中心或绑定旋转超出范围。');
    return [...v];
  };
  const bones = input.map((bone, index) => {
    if (
      !bone ||
      typeof bone.name !== 'string' ||
      !bone.name.trim() ||
      bone.name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(bone.name) ||
      ['__proto__', 'prototype', 'constructor'].includes(bone.name.trim()) ||
      names.has(bone.name.trim())
    )
      fail('骨骼名称需要唯一，为 1–80 字，不含控制字符或保留键名。');
    names.add(bone.name.trim());
    if (
      bone.parent !== undefined &&
      bone.parent !== null &&
      (!Number.isInteger(bone.parent) ||
        bone.parent < 0 ||
        bone.parent >= input.length ||
        bone.parent === index)
    )
      fail('父骨骼不存在或引用自身。');
    if (!Array.isArray(bone.elements) || bone.elements.length > elementCount)
      fail('骨骼的立方体引用无效。');
    const elements = bone.elements.map((element) => {
      if (
        !Number.isInteger(element) ||
        element < 0 ||
        element >= elementCount ||
        owners.has(element)
      )
        fail('每个立方体只能归属一个骨骼，且引用必须存在。');
      owners.add(element);
      return element;
    });
    return {
      name: bone.name.trim(),
      ...(bone.parent !== undefined && bone.parent !== null ? { parent: bone.parent } : {}),
      pivot: vector(bone.pivot, [8, 8, 8], -80, 80),
      rotation: vector(bone.rotation, [0, 0, 0], -360, 360),
      elements,
    };
  });
  if (owners.size !== elementCount) fail('每个立方体都需要归属一个骨骼；可创建空骨骼作为父分组。');
  for (let index = 0; index < bones.length; index++) {
    const seen = new Set();
    let current = index;
    while (current !== undefined) {
      if (seen.has(current) || seen.size >= 32) fail('骨骼不能循环引用，层级最多 32 层。');
      seen.add(current);
      current = bones[current].parent;
    }
  }
  return bones;
}

/** Explicit conversion preserves the legacy one-cube rig, clips and bind poses. */
export function withSkeleton(input) {
  const model = structuredClone(input);
  if (model.bones) return model;
  if (model.elements.some((e) => e.rotation?.rescale))
    throw new Error('请先烘焙 Java rescale，再转换为骨骼模型。');
  model.bones = model.elements.map((e, index) => {
    const rotation = ['x', 'y', 'z'].map((axis) =>
        e.rotation?.axis === axis ? e.rotation.angle : 0,
      ),
      pivot = [...(e.rotation?.origin ?? [8, 8, 8])];
    e.rotation = { origin: [...pivot], axis: 'x', angle: 0 };
    return { name: 'cube_' + index, pivot, rotation, elements: [index] };
  });
  for (const clip of model.clips)
    for (const track of clip.tracks) {
      track.bone = track.element;
      delete track.element;
    }
  return model;
}

/** Delete only empty, unanimated leaves; remap numeric parent/track references. */
export function removeBone(input, index) {
  const model = structuredClone(input);
  if (
    !model.bones?.[index] ||
    model.bones.length === 1 ||
    model.bones[index].elements.length ||
    model.bones.some((b) => b.parent === index) ||
    model.clips.some((c) => c.tracks.some((t) => t.bone === index))
  )
    throw new Error('只能删除没有立方体、子骨骼或动画轨道的骨骼。');
  model.bones.splice(index, 1);
  for (const bone of model.bones) if (bone.parent > index) bone.parent--;
  for (const clip of model.clips)
    for (const track of clip.tracks) if (track.bone > index) track.bone--;
  return model;
}

/** Conservative radius covering bind rotations and every linear clip pose. */
export function skeletonRadius(model) {
  const distance = (a, b = [0, 0, 0]) => Math.hypot(...a.map((v, i) => v - b[i]));
  const translation = model.bones.map(() => [0, 0, 0]),
    scale = model.bones.map(() => 1);
  for (const clip of model.clips)
    for (const track of clip.tracks)
      for (const frame of track.keyframes) {
        translation[track.bone] = translation[track.bone].map((v, i) =>
          Math.max(v, Math.abs(frame.translation[i])),
        );
        scale[track.bone] = Math.max(scale[track.bone], ...frame.scale);
      }
  const radius = (index) => {
    const bone = model.bones[index];
    let bound = 0;
    for (const elementIndex of bone.elements) {
      const element = model.elements[elementIndex],
        pivot = element.rotation?.origin ?? [8, 8, 8];
      let cube = 0;
      for (let corner = 0; corner < 8; corner++) {
        const point = [0, 1, 2].map(
          (axis) => (corner & (1 << axis) ? element.to : element.from)[axis],
        );
        cube = Math.max(cube, distance(point, pivot));
      }
      bound = Math.max(bound, distance(pivot, bone.pivot) + cube);
    }
    for (const [childIndex, child] of model.bones.entries())
      if (child.parent === index)
        bound = Math.max(
          bound,
          distance(child.pivot, bone.pivot) +
            distance(translation[childIndex]) +
            scale[childIndex] * radius(childIndex),
        );
    return bound;
  };
  return Math.max(
    ...model.bones.map((bone, index) =>
      bone.parent === undefined
        ? distance(bone.pivot, [8, 0, 8]) +
          distance(translation[index]) +
          scale[index] * radius(index)
        : 0,
    ),
  );
}

export function isSkeletonDocument(input) {
  if (!input || typeof input !== 'object') return false;
  const outliner = Array.isArray(input.outliner) ? input.outliner : [],
    elements = Array.isArray(input.elements) ? input.elements : [];
  if (
    input.minemod_skeleton === 1 ||
    (Array.isArray(input.groups) && input.groups.length) ||
    (!input.animations?.length && outliner.some((group) => group && typeof group === 'object'))
  )
    return true;
  return outliner.some(
    (group) =>
      group &&
      typeof group === 'object' &&
      (!Array.isArray(group.children) ||
        group.children.length !== 1 ||
        typeof group.children[0] !== 'string' ||
        (group.rotation !== undefined &&
          (!Array.isArray(group.rotation) || group.rotation.some((n) => n !== 0))) ||
        JSON.stringify(group.origin ?? [8, 8, 8]) !==
          JSON.stringify(elements.find((e) => e.uuid === group.children[0])?.origin ?? [8, 8, 8])),
  );
}
