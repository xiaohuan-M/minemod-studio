import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createImageProvider } from '../src/providers/image-compatible.mjs';
import { validateImage, pixelizeImage } from '../src/core/images.mjs';
import { pngTexture, placeholderTexture } from '../src/core/assets.mjs';
const png = pngTexture(placeholderTexture());
test('PNG decode rejects hostile dimensions and corruption, and local pixel conversion preserves alpha and color bounds', () => {
  const image = validateImage({ png: png.toString('base64') });
  assert.equal(image.width, 16);
  const pixels = pixelizeImage(image, 32, 4);
  assert.equal(pixels.pixels.length, 1024);
  assert.ok(new Set(pixels.pixels.filter((p) => !p.endsWith('00'))).size <= 4);
  assert.equal(pixels.pixels[0], '#00000000');
  const huge = Buffer.from(png);
  huge.writeUInt32BE(100000, 16);
  assert.throws(() => validateImage({ png: huge.toString('base64') }));
  const bad = Buffer.from(png);
  bad[50] ^= 255;
  assert.throws(() => validateImage({ png: bad.toString('base64') }));
  assert.throws(() => pixelizeImage(image, 1024));
});
test('Images adapter uses separate credentials, JSON generation, multipart reference edits, and bounded redacted failures', async (t) => {
  const calls = [];
  let mode = 'valid';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'error') {
      res.writeHead(500);
      res.end('fixture-image-key');
    } else
      res.end(
        JSON.stringify(
          mode === 'url'
            ? { data: [{ url: 'http://localhost/private' }] }
            : { data: [{ b64_json: png.toString('base64') }] },
        ),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));
  const provider = createImageProvider({
    MINEMOD_IMAGE_BASE_URL: 'http://127.0.0.1:' + server.address().port + '/v1',
    MINEMOD_IMAGE_MODEL: 'fixture-image-model',
    MINEMOD_IMAGE_API_KEY: 'fixture-image-key',
  });
  assert.equal(provider.info.configured, true);
  assert.ok(!JSON.stringify(provider.info).includes('fixture-image-key'));
  const generated = await provider.generate({ prompt: '晶体', view: 'three_view' });
  assert.equal(generated.kind, 'image');
  assert.equal(generated.source.demo, false);
  assert.equal(calls[0].path, '/v1/images/generations');
  assert.match(JSON.parse(calls[0].body).prompt, /front, side and back/);
  await provider.generate({ prompt: '转换风格', reference: generated.data });
  assert.equal(calls[1].path, '/v1/images/edits');
  assert.match(calls[1].headers['content-type'], /multipart\/form-data/);
  assert.match(calls[1].body, /filename="reference.png"/);
  mode = 'url';
  await assert.rejects(
    provider.generate({ prompt: '图片' }),
    (e) => e.code === 'IMAGE_PROVIDER_FORMAT',
  );
  mode = 'error';
  await assert.rejects(
    provider.generate({ prompt: '图片' }),
    (e) => e.code === 'IMAGE_PROVIDER_HTTP' && !e.message.includes('fixture-image-key'),
  );
  assert.equal(
    createImageProvider({
      MINEMOD_IMAGE_BASE_URL: 'http://external.example/v1',
      MINEMOD_IMAGE_MODEL: 'x',
    }).info.configured,
    false,
  );
});
