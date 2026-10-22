import { PNG } from 'pngjs';
import { AppError } from './errors.mjs';
const fail = () => {
  throw new AppError(
    422,
    'INVALID_IMAGE',
    '图片必须是有效 PNG，尺寸为 16–2048 像素，文件不超过 6 MiB。',
  );
};
export function decodePNG(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 33 ||
    bytes.length > 6 * 1024 * 1024 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    fail();
  const w = bytes.readUInt32BE(16),
    h = bytes.readUInt32BE(20);
  if (w < 16 || h < 16 || w > 2048 || h > 2048) fail();
  try {
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    if (decoded.width !== w || decoded.height !== h) fail();
    return decoded;
  } catch {
    fail();
  }
}
export function validateImage(value) {
  if (
    !value ||
    typeof value.png !== 'string' ||
    value.png.length > 8 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.png)
  )
    fail();
  const bytes = Buffer.from(value.png, 'base64'),
    image = decodePNG(bytes);
  return {
    width: image.width,
    height: image.height,
    png: PNG.sync.write(image, { colorType: 6 }).toString('base64'),
  };
}
/** Center-fit nearest-neighbour conversion with bounded palette quantization, entirely local. */
export function pixelizeImage(input, size = 32, colors = 16) {
  if (![16, 32, 64].includes(size) || ![4, 8, 16, 32, 64].includes(colors))
    throw new AppError(422, 'INVALID_INPUT', '请选择 16/32/64 像素和 4/8/16/32/64 色。');
  const img = decodePNG(Buffer.from(input.png, 'base64')),
    scale = Math.min(size / img.width, size / img.height),
    w = Math.max(1, Math.round(img.width * scale)),
    h = Math.max(1, Math.round(img.height * scale));
  const pixels = Array(size * size).fill('#00000000'),
    counts = new Map();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i =
        (Math.min(img.height - 1, Math.floor((y / h) * img.height)) * img.width +
          Math.min(img.width - 1, Math.floor((x / w) * img.width))) *
        4;
      const rgba = [...img.data.subarray(i, i + 4)];
      if (rgba[3] < 32) continue;
      const hex =
        '#' +
        rgba
          .map((v, j) => (j === 3 ? 255 : Math.round(v / 17) * 17).toString(16).padStart(2, '0'))
          .join('');
      pixels[(y + Math.floor((size - h) / 2)) * size + x + Math.floor((size - w) / 2)] = hex;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  const palette = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, colors)
    .map(([hex]) => ({ hex, rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) }));
  const cache = new Map();
  for (const [index, hex] of pixels.entries()) {
    if (hex === '#00000000') continue;
    if (!cache.has(hex)) {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      let best = palette[0],
        score = Infinity;
      for (const p of palette) {
        const d = p.rgb.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
        if (d < score) {
          best = p;
          score = d;
        }
      }
      cache.set(hex, best.hex);
    }
    pixels[index] = cache.get(hex);
  }
  return { width: size, height: size, pixels };
}
