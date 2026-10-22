import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

export const TARGET = Object.freeze({ edition: 'java', loader: 'fabric', minecraft: '1.21.1', java: 21 });

function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new AppError(400, 'INVALID_INPUT', `${field} 必须为 1–${max} 个字符。`);
  }
  return value.trim();
}

export function createProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_INPUT', '请提交项目对象。');
  }
  const unknown = Object.keys(input).filter((key) => !['name', 'prompt'].includes(key));
  if (unknown.length) throw new AppError(400, 'INVALID_INPUT', '当前只接受 name 和 prompt。');
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: text(input.name, '项目名称', 80),
    prompt: text(input.prompt, '模组想法', 4000),
    target: { ...TARGET },
    status: 'draft',
    revision: 0,
    spec: null,
    specSource: null,
    specHash: null,
    confirmedSpecHash: null,
    plan: null,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function assertProjectId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new AppError(400, 'INVALID_ID', '项目 ID 格式不正确。');
  }
}
