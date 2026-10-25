import { creationOptions } from './manager.mjs';
import { AppError } from '../core/errors.mjs';

const options = [
  'consent',
  'approved',
  'instruction',
  'textures',
  'models',
  'code',
  'gameTests',
  'refreshMaterials',
  'maxCalls',
  'maxRepairs',
  'allowNetwork',
];
export function creationRoutes({ creations, store, getProvider, requireConsent, modelActive }) {
  function authorize(input) {
    requireConsent(input);
    creationOptions(input);
    if (creations.active.size >= 2)
      throw new AppError(429, 'CREATION_LIMIT', '最多同时进行两个自动创作任务。');
    if (modelActive())
      throw new AppError(409, 'PLANNING_ACTIVE', '请等待当前模型请求结束后再开始自动创作。');
    return getProvider();
  }
  return async ({ request, response, url, json, body, fields, publicProject }) => {
    const path = url.pathname,
      method = request.method;
    if (path === '/api/creations' && method === 'POST') {
      const input = fields(await body(request), ['name', 'prompt', 'targetId', ...options]);
      const provider = authorize(input);
      const project = store.create({
        name:
          input.name ||
          String(input.prompt ?? '')
            .trim()
            .slice(0, 32),
        prompt: input.prompt,
        targetId: input.targetId,
      });
      json(response, 202, {
        project: publicProject(project),
        task: creations.start(project.id, { ...input, revision: project.revision }, provider),
      });
      return true;
    }
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)\/creations$/);
    if (projectMatch) {
      store.get(projectMatch[1]);
      if (method === 'GET') json(response, 200, { tasks: creations.list(projectMatch[1]) });
      else if (method === 'POST') {
        const input = fields(await body(request), ['revision', ...options]);
        json(response, 202, creations.start(projectMatch[1], input, authorize(input)));
      } else return false;
      return true;
    }
    const taskMatch = path.match(/^\/api\/creations\/([^/]+)(?:\/(cancel|resume))?$/);
    if (!taskMatch) return false;
    const [, id, action] = taskMatch;
    if (method === 'GET' && !action) json(response, 200, creations.get(id));
    else if (method === 'POST' && action === 'cancel') {
      fields(await body(request), []);
      json(response, 200, await creations.cancel(id));
    } else if (method === 'POST' && action === 'resume') {
      const input = fields(await body(request), [
        'revision',
        'consent',
        'approved',
        'maxCalls',
        'maxRepairs',
        'allowNetwork',
      ]);
      requireConsent(input);
      if (modelActive()) throw new AppError(409, 'PLANNING_ACTIVE', '已有模型请求运行。');
      json(response, 202, creations.resume(id, input, getProvider()));
    } else return false;
    return true;
  };
}
