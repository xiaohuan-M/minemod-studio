import { assetGeneration } from './core/asset-generation.mjs';
import { AppError } from './core/errors.mjs';
export function assetSessionRoutes({ sessions, assets, requireConsent, callModel }) {
  const pending = new Set();
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
    if (method !== 'GET' && pending.has(id))
      throw new AppError(409, 'SESSION_ACTIVE', '该素材会话正在生成，请等待或取消。');
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
        'withTexture',
        'regenerateTexture',
      ]);
      if (
        ['withTexture', 'regenerateTexture'].some(
          (k) => input[k] !== undefined && typeof input[k] !== 'boolean',
        )
      )
        throw new AppError(422, 'INVALID_INPUT', '贴图选项必须为布尔值。');
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
      pending.add(id);
      try {
        const geometry = context.currentData ? { ...context.currentData } : undefined;
        if (geometry && session.kind !== 'texture') delete geometry.texture;
        const result = await callModel(
          'asset-session:' + id,
          { ...context, currentData: geometry, reference },
          response,
          'planAsset',
        );
        if (session.kind !== 'texture') {
          let texture = context.currentData?.texture ?? result.data.texture;
          if (input.withTexture !== false && (!texture || input.regenerateTexture)) {
            const generated = await callModel(
              'asset-session:' + id,
              {
                kind: 'texture',
                prompt: (
                  '为 Minecraft 方块风格模型绘制协调的像素贴图。要求：' + input.prompt
                ).slice(0, 2000),
                ...(input.regenerateTexture && texture ? { currentData: texture } : {}),
                reference,
              },
              response,
              'planAsset',
            );
            texture = generated.data;
            const a = result.source?.usage,
              b = generated.source?.usage;
            result.source = {
              ...result.source,
              textureModel: generated.source?.model,
              usage: {
                inputTokens:
                  a?.inputTokens != null && b?.inputTokens != null
                    ? a.inputTokens + b.inputTokens
                    : null,
                outputTokens:
                  a?.outputTokens != null && b?.outputTokens != null
                    ? a.outputTokens + b.outputTokens
                    : null,
              },
            };
          }
          if (texture) result.data = { ...result.data, texture };
        }
        json(
          response,
          200,
          envelope(sessions.complete(id, session.revision, result, input.prompt)),
        );
      } finally {
        pending.delete(id);
      }
    } else return false;
    return true;
  };
}
