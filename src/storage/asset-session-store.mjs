import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonDirectory } from './json-directory.mjs';
import { AppError } from '../core/errors.mjs';
import { assetData } from '../core/asset-generation.mjs';
import { assetOrigins } from '../core/asset-origins.mjs';

export class AssetSessionStore {
  constructor(dataDir, assets) {
    this.records = new JsonDirectory(join(dataDir, 'asset-sessions'));
    this.assets = assets;
  }
  create({ kind, name }) {
    if (
      !['texture', 'model', 'animated_model'].includes(kind) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80
    )
      throw new AppError(422, 'INVALID_INPUT', '请填写素材类型与名称。');
    if (this.records.ids().length >= 100)
      throw new AppError(409, 'SESSION_LIMIT', '素材会话已达 100 个，请备份后整理。');
    const session = {
      id: randomUUID(),
      kind,
      name: name.trim(),
      revision: 0,
      currentAssetId: null,
      history: [],
      createdAt: new Date().toISOString(),
    };
    return this.records.write(session.id, session);
  }
  get(id) {
    const s = this.records.read(id);
    if (
      s.id !== id ||
      !Array.isArray(s.history) ||
      s.history.length > 100 ||
      !Number.isSafeInteger(s.revision)
    )
      throw new AppError(500, 'SESSION_CORRUPT', '素材会话损坏。');
    return s;
  }
  list() {
    return this.records
      .ids()
      .map((id) => this.get(id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  assertRevision(s, revision) {
    if (s.revision !== revision)
      throw new AppError(409, 'SESSION_CHANGED', '素材会话已更新，请重新载入。');
  }
  complete(id, revision, result, prompt) {
    const s = this.get(id);
    this.assertRevision(s, revision);
    if (result.kind !== s.kind) throw new AppError(422, 'ASSET_TYPE', '返回的素材种类与会话不同。');
    const base = s.currentAssetId ? this.assets.get(s.currentAssetId) : null;
    const asset = this.assets.create({
      kind: s.kind,
      name: s.name,
      data: assetData(s.kind, result.data),
      source: ('LLM: ' + (result.source?.model ?? 'configured')).slice(0, 200),
      license: base?.license ?? 'AI 生成；请核对服务商条款',
      derivedFrom: assetOrigins(base),
    });
    return this.records.write(id, {
      ...s,
      revision: s.revision + 1,
      currentAssetId: asset.id,
      history: [
        ...s.history,
        { assetId: asset.id, prompt, source: result.source, at: new Date().toISOString() },
      ].slice(-100),
    });
  }
  restore(id, revision, assetId) {
    const s = this.get(id);
    this.assertRevision(s, revision);
    if (!s.history.some((v) => v.assetId === assetId))
      throw new AppError(404, 'ASSET_NOT_FOUND', '该会话没有此版本。');
    this.assets.get(assetId);
    return this.records.write(id, { ...s, currentAssetId: assetId, revision: s.revision + 1 });
  }
}
