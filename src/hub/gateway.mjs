import { AppError } from '../core/errors.mjs';

const invalid = (message) => {
  throw new AppError(422, 'HUB_ROUTE', message);
};
export function hubRoutes(input = []) {
  if (!Array.isArray(input) || input.length > 20) invalid('托管线路最多 20 条。');
  const ids = new Set();
  return input.map((raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      !/^[a-z0-9_-]{1,40}$/.test(raw.id) ||
      ids.has(raw.id)
    )
      invalid('线路标识重复或无效。');
    ids.add(raw.id);
    let base;
    try {
      base = new URL(raw.baseUrl);
    } catch {
      invalid('线路基址无效。');
    }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
    if (
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) ||
      base.username ||
      base.password ||
      base.hash ||
      base.search
    )
      invalid('线路需要 HTTPS；HTTP 仅限回环地址。');
    if (typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 200)
      invalid('线路模型无效。');
    for (const key of ['inputCreditsPer1000', 'outputCreditsPer1000'])
      if (!Number.isSafeInteger(raw[key] ?? 0) || (raw[key] ?? 0) < 0 || (raw[key] ?? 0) > 10000)
        invalid('积分价格无效。');
    if (raw.apiKeyEnv && !/^[A-Z][A-Z0-9_]{0,100}$/.test(raw.apiKeyEnv))
      invalid('线路密钥环境变量名无效。');
    if (!local && (!raw.apiKeyEnv || !process.env[raw.apiKeyEnv]))
      invalid('请在服务端设置线路密钥。');
    base.pathname = base.pathname.replace(/\/+$/, '') + '/';
    return Object.freeze({
      id: raw.id,
      label: String(raw.label ?? raw.id).slice(0, 80),
      baseUrl: base.href,
      model: raw.model,
      apiKeyEnv: raw.apiKeyEnv,
      inputCreditsPer1000: raw.inputCreditsPer1000 ?? 0,
      outputCreditsPer1000: raw.outputCreditsPer1000 ?? 0,
    });
  });
}
export const publicRoute = ({ apiKeyEnv, ...route }) => route;
export const creditCost = (route, input, output) =>
  Math.ceil((route.inputCreditsPer1000 * input + route.outputCreditsPer1000 * output) / 1000);

export class ModelGateway {
  constructor(store, routes) {
    this.store = store;
    this.routes = routes;
    this.active = new Map();
    this.controllers = new Set();
    this.closing = false;
  }
  async complete(user, route, input, signal) {
    if (this.closing) throw new AppError(503, 'HUB_STOPPING', '线路正在退出。');
    if (
      (this.active.get(user.id) ?? 0) >= 2 ||
      [...this.active.values()].reduce((a, b) => a + b, 0) >= 16
    )
      throw new AppError(429, 'HUB_MODEL_BUSY', '模型线路繁忙，请稍后再试。');
    if (
      !input ||
      !Array.isArray(input.messages) ||
      !input.messages.length ||
      input.messages.length > 50 ||
      input.stream === true
    )
      invalid('使用非流式 Chat Completions，最多 50 条消息。');
    if (input.model && input.model !== route.model) invalid('请求模型与所选线路不符。');
    const maxTokens = input.max_completion_tokens ?? input.max_tokens ?? 4096;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192)
      invalid('最大输出为 1–8192 token。');
    const messages = input.messages;
    if (
      messages.some(
        (m) =>
          !m ||
          !['system', 'user', 'assistant'].includes(m.role) ||
          !(typeof m.content === 'string' || Array.isArray(m.content)),
      )
    )
      invalid('消息格式无效。');
    // Reserve conservatively from serialized UTF-8 bytes and the output limit.
    // Charges can never exceed this displayed reservation, including images.
    const bytes = Buffer.byteLength(JSON.stringify(messages));
    if (bytes > 12 * 1024 * 1024) invalid('消息超过 12 MiB。');
    for (const message of messages)
      if (Array.isArray(message.content)) {
        if (message.content.length > 10) invalid('每条消息最多 10 个内容片段。');
        for (const part of message.content) {
          const text = part?.type === 'text' && typeof part.text === 'string';
          const image =
            part?.type === 'image_url' &&
            typeof part.image_url?.url === 'string' &&
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url.url);
          if (!text && !image)
            invalid('消息片段只接受文本和内嵌 PNG/JPEG/WebP，不代理外部图片地址。');
        }
      }
    const reserved = creditCost(route, bytes, maxTokens),
      reservation = this.store.reserve(user.id, route.id, reserved);
    this.active.set(user.id, (this.active.get(user.id) ?? 0) + 1);
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const payload = {
        model: route.model,
        messages,
        stream: false,
        [input.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens']:
          maxTokens,
      };
      if (input.response_format?.type === 'json_object')
        payload.response_format = { type: 'json_object' };
      if (typeof input.temperature === 'number' && input.temperature >= 0 && input.temperature <= 2)
        payload.temperature = input.temperature;
      const response = await fetch(new URL('chat/completions', route.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(route.apiKeyEnv ? { Authorization: 'Bearer ' + process.env[route.apiKeyEnv] } : {}),
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.any([
          signal ?? new AbortController().signal,
          controller.signal,
          AbortSignal.timeout(120000),
        ]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(502, 'HUB_UPSTREAM', '上游模型请求失败，未扣积分。');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new AppError(502, 'HUB_RESPONSE', '上游响应过大。');
        chunks.push(chunk);
      }
      let result;
      try {
        result = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new AppError(502, 'HUB_RESPONSE', '上游未返回有效 JSON。');
      }
      if (!Array.isArray(result.choices) || typeof result.choices[0]?.message?.content !== 'string')
        throw new AppError(502, 'HUB_RESPONSE', '上游缺少模型输出。');
      const a = result.usage?.prompt_tokens,
        b = result.usage?.completion_tokens,
        known =
          Number.isSafeInteger(a) &&
          a >= 0 &&
          Number.isSafeInteger(b) &&
          b >= 0 &&
          a <= 10000000 &&
          b <= 10000000;
      const billed = this.store.settle(
        reservation,
        known ? creditCost(route, a, b) : 0,
        known ? { inputTokens: a, outputTokens: b } : null,
        known ? 'completed' : 'unknown-usage',
      );
      return {
        ...result,
        minemodBilling: { ...billed, reserved, usageKnown: known, routeId: route.id },
      };
    } catch (error) {
      this.store.settle(reservation, 0, null, 'failed');
      throw error;
    } finally {
      this.controllers.delete(controller);
      const n = this.active.get(user.id) - 1;
      if (n) this.active.set(user.id, n);
      else this.active.delete(user.id);
    }
  }
  close() {
    this.closing = true;
    for (const controller of this.controllers) controller.abort();
  }
}
