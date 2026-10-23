import { AppError } from './errors.mjs';

const invalid = (message) => {
  throw new AppError(422, 'INVALID_PROVIDER_PROFILE', message);
};
export function profileKind(kind) {
  if (!['text', 'image'].includes(kind)) invalid('服务类型必须是 text 或 image。');
  return kind;
}
const text = (value, label, limit) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit ||
    /[\u0000-\u001f]/.test(value)
  )
    invalid(label + '不能为空、过长或含控制字符。');
  return value.trim();
};
export function normalizeProfile(input, previous = null) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !['name', 'kind', 'baseUrl', 'model', 'apiKey', 'options'].includes(k),
    )
  )
    invalid('服务配置字段不正确。');
  const kind = profileKind(input.kind);
  if (previous && previous.kind !== kind) invalid('已有配置不能变更类型，请新建另一类服务。');
  const name = text(input.name, '配置名称', 60),
    model = text(input.model, '模型名称', 200);
  let base;
  try {
    base = new URL(text(input.baseUrl, '接口基址', 2048));
  } catch {
    invalid('请输入完整的 HTTPS 接口基址；本机可使用 HTTP。');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !(base.protocol === 'https:' || (local && base.protocol === 'http:'))
  )
    invalid('远程服务必须使用 HTTPS，地址不能包含用户名、密码、查询参数或片段。');
  const apiKey = input.apiKey === undefined ? (previous?.apiKey ?? '') : input.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\u0000-\u001f]/.test(apiKey))
    invalid('API Key 格式不正确。');
  if (!local && !apiKey.trim()) invalid('远程服务需要 API Key；已有配置留空可保留密钥。');
  const options = input.options ?? previous?.options ?? {};
  const defaults =
    kind === 'text'
      ? { timeoutMs: 45000, maxTokens: 4096, jsonMode: true, tokenField: 'max_tokens' }
      : { timeoutMs: 120000, responseFormat: 'b64_json' };
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((k) => !Object.hasOwn(defaults, k))
  )
    invalid('高级配置字段不正确。');
  const finalOptions = { ...defaults, ...options };
  if (
    !Number.isInteger(finalOptions.timeoutMs) ||
    finalOptions.timeoutMs < 1000 ||
    finalOptions.timeoutMs > (kind === 'text' ? 120000 : 180000)
  )
    invalid('超时范围不正确。');
  if (kind === 'text') {
    if (
      !Number.isInteger(finalOptions.maxTokens) ||
      finalOptions.maxTokens < 256 ||
      finalOptions.maxTokens > 8192 ||
      typeof finalOptions.jsonMode !== 'boolean' ||
      !['max_tokens', 'max_completion_tokens'].includes(finalOptions.tokenField)
    )
      invalid('文本服务高级配置不正确。');
  } else if (!['b64_json', 'auto'].includes(finalOptions.responseFormat))
    invalid('图像响应格式必须是 b64_json 或 auto。');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  if (base.href.length > 2048) invalid('规范化后的接口基址过长。');
  return { name, kind, baseUrl: base.href, model, apiKey: apiKey.trim(), options: finalOptions };
}

export function publicProfile({ apiKey, ...profile }) {
  return { ...profile, hasApiKey: !!apiKey };
}
