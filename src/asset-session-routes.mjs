import { assetGeneration } from './core/asset-generation.mjs';
import { AppError } from './core/errors.mjs';
export function assetSessionRoutes({ sessions, assets, requireConsent, callModel }) {
  const envelope = (session) => ({
    ...session,
    data: session.currentAssetId ? assets.get(session.currentAssetId).data : null,
  });
  return async ({ request, response, url, json, body, fields }) => {
    const path = url.pathname,
      method = request.method;
    if (path === '/api/asset-sessions') {
      if (method === 'GET') json(response, 200, { sessions: sessions.list() });
      else if (method === 'POST')
        json(
          response,
          201,
          envelope(sessions.create(fields(await body(request), ['kind', 'name']))),
        );
      else return false;
      return true;
    }
    const match = path.match(/^\/api\/asset-sessions\/([^/]+)(?:\/(generate|restore))?$/);
    if (!match) return false;
    const [, id, action] = match,
      session = sessions.get(id);
    if (method === 'GET' && !action) json(response, 200, envelope(session));
    else if (method === 'POST' && action === 'restore') {
      const input = fields(await body(request), ['revision', 'assetId']);
      json(response, 200, envelope(sessions.restore(id, input.revision, input.assetId)));
    } else if (method === 'POST' && action === 'generate') {
      const input = fields(await body(request, 256 * 1024), [
        'revision',
        'prompt',
        'consent',
        'currentData',
        'referenceId',
      ]);
      sessions.assertRevision(session, input.revision);
      requireConsent(input);
      const context = assetGeneration({
        kind: session.kind,
        prompt: input.prompt,
        currentData:
          input.currentData ??
          (session.currentAssetId ? assets.get(session.currentAssetId).data : undefined),
        conversation: session.history.slice(-12).map((h) => h.prompt),
      });
      let reference;
      if (input.referenceId) {
        const asset = assets.get(input.referenceId);
        if (asset.kind !== 'image') throw new AppError(422, 'ASSET_TYPE', '参考图需要图片资源。');
        reference = asset.data;
      }
      const result = await callModel(
        'asset-session:' + id,
        { ...context, reference },
        response,
        'planAsset',
      );
      json(response, 200, envelope(sessions.complete(id, session.revision, result, input.prompt)));
    } else return false;
    return true;
  };
}
