import { deflateSync, crc32 } from 'node:zlib';
import { AppError } from './errors.mjs';
const fail = (message) => {
  throw new AppError(422, 'INVALID_ASSET', message);
};
export function validateTexture(input) {
  if (
    !input ||
    ![16, 32, 64].includes(input.width) ||
    input.height !== input.width ||
    !Array.isArray(input.pixels) ||
    input.pixels.length !== input.width * input.height ||
    input.pixels.some((p) => typeof p !== 'string' || !/^#[0-9a-fA-F]{8}$/.test(p))
  )
    fail('贴图必须为 16、32 或 64 像素正方形，像素格式为 #RRGGBBAA。');
  return {
    width: input.width,
    height: input.height,
    pixels: input.pixels.map((p) => p.toLowerCase()),
  };
}
export function pngTexture(input) {
  const texture = validateTexture(input);
  const raw = Buffer.alloc((texture.width * 4 + 1) * texture.height);
  for (let y = 0; y < texture.height; y++)
    for (let x = 0; x < texture.width; x++)
      Buffer.from(texture.pixels[y * texture.width + x].slice(1), 'hex').copy(
        raw,
        y * (texture.width * 4 + 1) + 1 + x * 4,
      );
  const chunk = (kind, data) => {
    const type = Buffer.from(kind),
      out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    type.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(texture.width);
  ihdr.writeUInt32BE(texture.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function placeholderTexture(color = '#8e62cf', block = false) {
  const rgb = color.slice(1);
  const pixels = Array.from({ length: 256 }, (_, i) => {
    const x = i % 16,
      y = Math.floor(i / 16);
    if (!block && (x < 2 || x > 13 || y < 2 || y > 13)) return '#00000000';
    const scale = (x + y) % 4 === 0 ? 0.65 : 1;
    return (
      '#' +
      [0, 2, 4]
        .map((at) =>
          Math.round(parseInt(rgb.slice(at, at + 2), 16) * scale)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('') +
      'ff'
    );
  });
  return { width: 16, height: 16, pixels };
}
export function validateModel(input) {
  if (
    !input ||
    !Array.isArray(input.elements) ||
    !input.elements.length ||
    input.elements.length > 128
  )
    fail('模型需要 1–128 个立方体。');
  const vector = (v, min, max) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max);
  const elements = input.elements.map((e, index) => {
    if (
      !e ||
      !vector(e.from, -16, 32) ||
      !vector(e.to, -16, 32) ||
      e.from.some((v, i) => v >= e.to[i])
    )
      fail('立方体 ' + index + ' 的 from/to 必须有正体积，坐标为 -16–32。');
    const element = { from: [...e.from], to: [...e.to] };
    if (e.rotation) {
      const r = e.rotation;
      if (
        !vector(r.origin, -16, 32) ||
        !['x', 'y', 'z'].includes(r.axis) ||
        ![-45, -22.5, 0, 22.5, 45].includes(r.angle)
      )
        fail('模型仅支持 Java 方块格式的单轴 0、±22.5、±45 度旋转。');
      element.rotation = { origin: [...r.origin], axis: r.axis, angle: r.angle };
    }
    element.faces = Object.fromEntries(
      ['north', 'south', 'east', 'west', 'up', 'down'].map((face) => {
        const uv = e.faces?.[face]?.uv ?? [0, 0, 16, 16];
        if (
          !Array.isArray(uv) ||
          uv.length !== 4 ||
          uv.some((n) => !Number.isFinite(n) || n < 0 || n > 16)
        )
          fail('模型 UV 必须在 0–16 范围。');
        return [face, { uv: [...uv], texture: '#0' }];
      }),
    );
    return element;
  });
  return { elements };
}
export function importBlockbench(input) {
  if (
    !input ||
    !Array.isArray(input.elements) ||
    input.elements.some((e) => e.type && e.type !== 'cube') ||
    (input.animations?.length ?? 0) > 0
  )
    fail('仅可导入静态立方体 bbmodel；网格、骨骼动画暂不适用于 Java 物品模型。');
  if (
    (input.groups?.length ?? 0) > 0 ||
    (Array.isArray(input.outliner) &&
      input.outliner.some((entry) => entry && typeof entry === 'object'))
  )
    fail('请先在 Blockbench 展平模型组后导出。');
  if ((input.textures?.length ?? 0) > 1) fail('当前模型只支持单张贴图，请先合并贴图。');
  const width = input.resolution?.width ?? 16,
    height = input.resolution?.height ?? 16;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 4096))
    fail('模型纹理分辨率不正确。');
  return validateModel({
    elements: input.elements.map((e) => {
      if (
        e.faces &&
        Object.values(e.faces).some(
          (face) => face.texture === null || face.texture === false || (face.rotation ?? 0) !== 0,
        )
      )
        fail('请先烘焙 UV 旋转并显示模型所有立方体面。');
      if (e.rotation && (!Array.isArray(e.rotation) || e.rotation.length !== 3))
        fail('模型旋转必须为三个数值。');
      const nonzero = (e.rotation ?? [0, 0, 0]).map((n, i) => ({ n, i })).filter((v) => v.n !== 0);
      if (nonzero.length > 1) fail('多轴旋转不能直接导入 Java 物品模型，请先烘焙旋转。');
      return {
        from: e.from,
        to: e.to,
        ...(nonzero.length
          ? {
              rotation: {
                origin: e.origin ?? [8, 8, 8],
                axis: ['x', 'y', 'z'][nonzero[0].i],
                angle: nonzero[0].n,
              },
            }
          : {}),
        faces: Object.fromEntries(
          Object.entries(e.faces ?? {}).map(([face, value]) => [
            face,
            { uv: value.uv?.map((n, i) => (n * 16) / (i % 2 ? height : width)) },
          ]),
        ),
      };
    }),
  });
}
export function exportBlockbench(model, name, texture) {
  const clean = validateModel(model);
  return {
    meta: { format_version: '4.10', model_format: 'java_block', box_uv: false },
    name,
    resolution: { width: 16, height: 16 },
    elements: clean.elements.map((e, index) => ({
      name: 'cube_' + index,
      type: 'cube',
      uuid: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
      from: e.from,
      to: e.to,
      origin: e.rotation?.origin ?? [8, 8, 8],
      rotation: ['x', 'y', 'z'].map((axis) => (axis === e.rotation?.axis ? e.rotation.angle : 0)),
      faces: Object.fromEntries(
        Object.entries(e.faces).map(([face, v]) => [face, { uv: v.uv, texture: 0 }]),
      ),
    })),
    outliner: clean.elements.map(
      (_, index) => '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    ),
    textures: [
      {
        name: 'texture.png',
        id: '0',
        uuid: '00000000-0000-4000-8000-999999999999',
        source:
          'data:image/png;base64,' + pngTexture(texture ?? placeholderTexture()).toString('base64'),
      },
    ],
  };
}
