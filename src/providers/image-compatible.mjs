import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors.mjs';
import { validateImage } from '../core/images.mjs';
const fail = (status, code, message) => new AppError(status, code, message);
/** Independent Images API adapter; never assumes a text model can return raster images. */
export function createImageProvider(env = process.env) {
  const info = { id: 'image-compatible', configured: false, label: '自定义图像 API' };
  let base, key, model, timeout;
  try {
    base = new URL(env.MINEMOD_IMAGE_BASE_URL);
    key = env.MINEMOD_IMAGE_API_KEY?.trim() ?? '';
    model = env.MINEMOD_IMAGE_MODEL?.trim();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.href.length > 2048 ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && local))
    )
      throw Error();
    if (
      (!local && !key) ||
      key.length > 8192 ||
      /[\u0000-\u001f]/.test(key) ||
      !model ||
      model.length > 200 ||
      /[\u0000-\u001f]/.test(model)
    )
      throw Error();
    timeout = Number(env.MINEMOD_IMAGE_TIMEOUT_MS ?? 120000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180000) throw Error();
    base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  } catch {
    return {
      info: {
        ...info,
        configurationError:
          '请设置 MINEMOD_IMAGE_BASE_URL、MINEMOD_IMAGE_MODEL 和服务端 MINEMOD_IMAGE_API_KEY。',
      },
    };
  }
  Object.assign(info, {
    configured: true,
    baseUrl: base.href,
    model,
    configurationId: randomUUID(),
    timeoutMs: timeout,
  });
  return {
    info,
    async generate({ prompt, view = 'concept', reference = null }, { signal } = {}) {
      const timer = AbortSignal.timeout(timeout),
        combined = signal ? AbortSignal.any([signal, timer]) : timer;
      const direction = {
        concept: 'Create a clear Minecraft-inspired concept art sheet.',
        three_view:
          'Create an orthographic turnaround with front, side and back views at consistent scale.',
        detail:
          'Create a close-up design sheet showing material, silhouette and construction details.',
        texture: 'Create a flat, seamless pixel-art texture, no perspective and no text.',
      }[view];
      if (!direction || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000)
        throw fail(422, 'INVALID_INPUT', '请填写 1–2000 字描述并选择图片类型。');
      let body,
        headers = { ...(key ? { Authorization: 'Bearer ' + key } : {}) };
      if (reference) {
        const image = validateImage(reference);
        body = new FormData();
        body.set('model', model);
        body.set('prompt', direction + '\n' + prompt);
        body.set('n', '1');
        body.set('size', '1024x1024');
        body.set(
          'image',
          new Blob([Buffer.from(image.png, 'base64')], { type: 'image/png' }),
          'reference.png',
        );
        if (env.MINEMOD_IMAGE_RESPONSE_FORMAT !== 'auto') body.set('response_format', 'b64_json');
      } else {
        body = JSON.stringify({
          model,
          prompt: direction + '\n' + prompt,
          n: 1,
          size: '1024x1024',
          ...(env.MINEMOD_IMAGE_RESPONSE_FORMAT === 'auto' ? {} : { response_format: 'b64_json' }),
        });
        headers['Content-Type'] = 'application/json';
      }
      try {
        const response = await fetch(
          new URL(reference ? 'images/edits' : 'images/generations', base),
          { method: 'POST', headers, body, signal: combined, redirect: 'manual' },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw fail(
            response.status === 429 ? 429 : 502,
            'IMAGE_PROVIDER_HTTP',
            '图像服务请求失败（HTTP ' +
              response.status +
              '），请检查地址、模型、权限与该服务的 Images API 兼容性。',
          );
        }
        if (!response.body) throw fail(502, 'IMAGE_PROVIDER_EMPTY', '图像服务返回空响应。');
        const reader = response.body.getReader(),
          chunks = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 12 * 1024 * 1024)
              throw fail(502, 'IMAGE_PROVIDER_LIMIT', '图片响应超过 12 MiB。');
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw fail(502, 'IMAGE_PROVIDER_INVALID', '图像服务未返回有效 JSON。');
        }
        const encoded = payload?.data?.[0]?.b64_json;
        if (typeof encoded !== 'string')
          throw fail(
            422,
            'IMAGE_PROVIDER_FORMAT',
            '服务需要返回 b64_json PNG；本适配器不会自动访问响应中的第三方图片 URL。可尝试 MINEMOD_IMAGE_RESPONSE_FORMAT=auto。',
          );
        const data = validateImage({ png: encoded });
        combined.throwIfAborted();
        return {
          kind: 'image',
          data,
          source: { provider: 'image-compatible', model, demo: false },
          view,
        };
      } catch (error) {
        if (signal?.aborted)
          throw fail(499, 'PROVIDER_CANCELLED', '图片请求已取消，服务商可能仍会计费。');
        if (timer.aborted) throw fail(504, 'PROVIDER_TIMEOUT', '图像服务超时。');
        if (error instanceof AppError) throw error;
        throw fail(502, 'IMAGE_PROVIDER_UNREACHABLE', '无法连接图像服务，请检查网络和配置。');
      }
    },
  };
}
