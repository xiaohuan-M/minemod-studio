import { BoxGeometry, Euler, Matrix3, Matrix4, Vector3 } from 'three';
import { validateModel } from '../core/assets.mjs';
import { validateAnimation } from '../core/animation.mjs';
import { skeletonRadius } from '../core/skeleton.mjs';
import { AppError } from '../core/errors.mjs';

/** Compile validated cuboids to immutable render data. No user code or dependency. */
export function entityMesh(input, kind, selectedClip) {
  const model = kind === 'animated_model' ? validateAnimation(input) : validateModel(input),
    hierarchy = !!model.bones;
  const clip = model.clips?.find((c) => c.name === (selectedClip ?? model.clips[0].name));
  if (selectedClip && !clip) throw new AppError(422, 'ANIMATION_CLIP', '模型中没有所选动画片段。');
  const bones =
    model.bones ??
    model.elements.map((e, i) => ({
      name: 'cube_' + i,
      pivot: e.rotation?.origin ?? [8, 8, 8],
      rotation: [0, 0, 0].map((_, axis) =>
        e.rotation?.axis === 'xyz'[axis] ? e.rotation.angle : 0,
      ),
      elements: [i],
    }));
  const compiled = bones.map((b) => ({
    parent: b.parent ?? -1,
    position: b.pivot.map(
      (v, i) => (v - (b.parent === undefined ? [8, 0, 8] : bones[b.parent].pivot)[i]) / 16,
    ),
    rotation: b.rotation,
    children: [],
    vertices: [],
  }));
  compiled.forEach((bone, index) => {
    if (bone.parent >= 0) compiled[bone.parent].children.push(index);
  });
  model.elements.forEach((e, index) => {
    const bone = bones.findIndex((b) => b.elements.includes(index)),
      origin = e.rotation?.origin ?? [8, 8, 8],
      center = e.from.map((v, i) => (v + e.to[i]) / 2),
      rotation = [0, 0, 0];
    if (hierarchy && e.rotation)
      rotation['xyz'.indexOf(e.rotation.axis)] = (e.rotation.angle * Math.PI) / 180;
    const scale = [1, 1, 1];
    if (e.rotation?.rescale)
      for (let i = 0; i < 3; i++)
        if ('xyz'[i] !== e.rotation.axis)
          scale[i] = 1 / Math.cos((e.rotation.angle * Math.PI) / 180);
    const transform = new Matrix4()
      .makeTranslation(...origin.map((v, i) => v - bones[bone].pivot[i]))
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(...rotation)))
      .multiply(new Matrix4().makeScale(...scale))
      .multiply(new Matrix4().makeTranslation(...center.map((v, i) => v - origin[i])));
    const normalMatrix = new Matrix3().getNormalMatrix(transform),
      geometry = new BoxGeometry(...e.to.map((v, i) => v - e.from[i])),
      p = geometry.attributes.position,
      n = geometry.attributes.normal;
    ['east', 'west', 'up', 'down', 'south', 'north'].forEach((name, face) => {
      const f = e.faces?.[name];
      if (f === null) return;
      const [a, b, c, d] = f?.uv ?? [0, 0, 16, 16];
      let uv = [
        [a, b],
        [c, b],
        [a, d],
        [c, d],
      ];
      for (let r = 0; r < (f?.rotation ?? 0) / 90; r++) uv = [uv[2], uv[0], uv[3], uv[1]];
      for (const corner of [0, 2, 3, 1]) {
        const at = face * 4 + corner,
          v = new Vector3().fromBufferAttribute(p, at).applyMatrix4(transform).divideScalar(16),
          normal = new Vector3().fromBufferAttribute(n, at).applyNormalMatrix(normalMatrix);
        compiled[bone].vertices.push([...v, ...uv[corner].map((x) => x / 16), ...normal]);
      }
    });
    geometry.dispose();
  });
  let radius;
  if (hierarchy)
    radius = (skeletonRadius({ ...model, clips: model.clips ?? [] }) * Math.SQRT2) / 16;
  else
    radius = Math.max(
      ...compiled.map((bone, i) => {
        const frames = (model.clips ?? []).flatMap((c) =>
          c.tracks.filter((t) => t.element === i).flatMap((t) => t.keyframes),
        );
        return (
          Math.hypot(...bone.position) +
          Math.max(0, ...frames.map((f) => Math.hypot(...f.translation) / 16)) +
          Math.max(1, ...frames.flatMap((f) => f.scale)) *
            Math.max(0, ...bone.vertices.map((v) => Math.hypot(...v.slice(0, 3))))
        );
      }),
    );
  if (!Number.isFinite(radius) || radius > 64)
    throw new AppError(422, 'MODEL_BOUNDS', '实体动画范围超过 64 格，请缩小位移、缩放或层级。');
  return {
    version: 1,
    order: hierarchy ? 'ZYX' : 'XYZ',
    radius: Math.max(0.25, radius),
    bones: compiled,
    ...(clip
      ? {
          clip: {
            name: clip.name,
            duration: clip.duration,
            loop: clip.loop,
            tracks: clip.tracks.map((t) => ({
              bone: t.bone ?? t.element,
              keyframes: t.keyframes.map((f) => ({
                ...f,
                translation: f.translation.map((v) => v / 16),
              })),
            })),
          },
        }
      : {}),
  };
}
