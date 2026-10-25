import { AppError } from '../core/errors.mjs';

export function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function fields(input, allowed) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    throw new AppError(400, 'INVALID_INPUT', '请求字段不正确。');
  }
  return input;
}

export async function body(request, limit = 24 * 1024) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', '请求必须使用 application/json。');
  }
  if (Number(request.headers['content-length']) > limit)
    throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'JSON 格式不正确。');
  }
}
