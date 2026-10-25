import { AppError } from './core/errors.mjs';

export function providerSettingsRoutes({
  profiles,
  isActive,
  onChanged,
  environment,
  validate = null,
}) {
  const summary = () => ({ ...profiles.summary(), environment });
  return async ({ request, response, url, json, body, fields }) => {
    if (!url.pathname.startsWith('/api/settings/providers')) return false;
    const match = url.pathname.match(/^\/api\/settings\/providers(?:\/(activate|[a-f0-9-]{36}))?$/);
    if (!match) return false;
    if (request.method === 'GET' && !match[1]) {
      json(response, 200, summary());
      return true;
    }
    const operation =
      !match[1] && request.method === 'POST'
        ? 'save'
        : match[1] === 'activate' && request.method === 'POST'
          ? 'activate'
          : match[1] && match[1] !== 'activate' && request.method === 'PUT'
            ? 'save'
            : match[1] && match[1] !== 'activate' && request.method === 'DELETE'
              ? 'remove'
              : null;
    if (!operation) return false;
    if (isActive())
      throw new AppError(
        409,
        'PROVIDER_REQUEST_ACTIVE',
        '请先等待或取消当前文本/图片请求，再修改服务配置。',
      );
    const input = fields(
      await body(request),
      operation === 'save'
        ? ['revision', 'name', 'kind', 'baseUrl', 'model', 'apiKey', 'options']
        : operation === 'activate'
          ? ['revision', 'kind', 'profileId']
          : ['revision'],
    );
    const { revision, ...data } = input;
    // Check again after the asynchronous body read; a request may have started meanwhile.
    if (isActive())
      throw new AppError(409, 'PROVIDER_REQUEST_ACTIVE', '模型请求正在运行，请稍后重试。');
    if (operation === 'save') {
      validate?.(data);
      profiles.save(data, revision, match[1] ?? null);
    } else if (operation === 'activate') profiles.activate(data.kind, data.profileId, revision);
    else profiles.remove(match[1], revision);
    onChanged(); // Rebuild configurations, invalidating all previously granted consent IDs.
    json(response, operation === 'save' && !match[1] ? 201 : 200, summary());
    return true;
  };
}
