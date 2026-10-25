import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonDirectory } from './json-directory.mjs';
import { validateTexture, validateModel, importBlockbench } from '../core/assets.mjs';
import { validateAnimation } from '../core/animation.mjs';
import { validateImage } from '../core/images.mjs';
import { sha256 } from '../core/archive.mjs';
import { AppError } from '../core/errors.mjs';
import { normalizeOrigins } from '../core/asset-origins.mjs';
export class AssetStore {
  constructor(dataDir) {
    this.records = new JsonDirectory(join(dataDir, 'assets'));
  }
  prepare(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !['name', 'kind', 'data', 'source', 'license', 'format', 'derivedFrom'].includes(k),
      )
    )
      throw new AppError(400, 'INVALID_ASSET', '资源字段不正确。');
    for (const [field, max] of [
      ['name', 80],
      ['source', 200],
      ['license', 200],
    ])
      if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > max)
        throw new AppError(422, 'INVALID_ASSET', '请填写资源名称、来源和许可说明。');
    if (!['texture', 'model', 'image', 'animated_model'].includes(input.kind))
      throw new AppError(422, 'INVALID_ASSET', '请选择贴图、模型或图片。');

    const data =
      input.kind === 'animated_model'
        ? validateAnimation(input.data)
        : input.kind === 'image'
          ? validateImage(input.data)
          : input.kind === 'texture'
            ? validateTexture(input.data)
            : input.format === 'bbmodel'
              ? importBlockbench(input.data)
              : validateModel(input.data);
    const origins = normalizeOrigins(input.derivedFrom);
    const record = {
      id: randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      data,
      source: input.source.trim(),
      license: input.license.trim(),
      createdAt: new Date().toISOString(),
      sha256: sha256(JSON.stringify(data)),
      ...(origins ? { derivedFrom: origins } : {}),
    };
    return record;
  }
  create(input) {
    if (this.records.ids().length >= 500)
      throw new AppError(409, 'ASSET_LIMIT', '资源库达到 500 项，请备份并整理资源。');
    const record = this.prepare(input);
    return this.records.write(record.id, record);
  }
  exportPackage(ids = this.records.ids()) {
    const assets = ids.map((id) => {
      const { name, kind, data, source, license, derivedFrom } = this.get(id);
      return { name, kind, data, source, license, ...(derivedFrom ? { derivedFrom } : {}) };
    });
    const payload = { format: 'minemod-assets', version: 1, assets };
    if (Buffer.byteLength(JSON.stringify(payload)) > 32 * 1024 * 1024)
      throw new AppError(422, 'ASSET_LIMIT', '资源包超过 32 MiB，请单独导出资源。');
    return { ...payload, checksum: sha256(JSON.stringify(payload)) };
  }
  importPackage(input) {
    const { checksum, ...payload } = input ?? {};
    if (
      payload.format !== 'minemod-assets' ||
      payload.version !== 1 ||
      !Array.isArray(payload.assets) ||
      !payload.assets.length ||
      payload.assets.length > 500 ||
      sha256(JSON.stringify(payload)) !== checksum
    )
      throw new AppError(422, 'INVALID_ASSET_PACKAGE', '资源包格式或校验失败。');
    if (this.records.ids().length + payload.assets.length > 500)
      throw new AppError(409, 'ASSET_LIMIT', '导入会超出 500 项资源限制。');
    const prepared = payload.assets.map((asset) => this.prepare(asset)),
      written = [];
    try {
      for (const record of prepared) {
        this.records.write(record.id, record);
        written.push(record.id);
      }
      return prepared;
    } catch (error) {
      for (const id of written) unlinkSync(this.records.path(id));
      throw error;
    }
  }
  get(id) {
    const record = this.records.read(id);
    if (record.id !== id || sha256(JSON.stringify(record.data)) !== record.sha256)
      throw new AppError(500, 'ASSET_CORRUPT', '资源校验失败。');
    if (record.derivedFrom) record.derivedFrom = normalizeOrigins(record.derivedFrom);
    record.data =
      record.kind === 'animated_model'
        ? validateAnimation(record.data)
        : record.kind === 'image'
          ? validateImage(record.data)
          : record.kind === 'texture'
            ? validateTexture(record.data)
            : validateModel(record.data);
    return record;
  }
  list() {
    return this.records
      .ids()
      .map((id) => {
        const { data, ...metadata } = this.get(id);
        return {
          ...metadata,
          ...(['texture', 'image'].includes(metadata.kind)
            ? { width: data.width, height: data.height }
            : { cubes: data.elements.length }),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
