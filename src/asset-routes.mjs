import {
  validateAnimation,
  exportAnimatedBlockbench,
  importAnimatedBlockbench,
  bedrockAnimationResources,
} from './core/animation.mjs';
import { zipFiles } from './core/archive.mjs';
import catalog from '../community/catalog.json' with { type: 'json' };
import { sha256 } from './core/archive.mjs';
import { pixelizeImage, decodePNG } from './core/images.mjs';
import {
  pngTexture,
  placeholderTexture,
  exportBlockbench,
  importBlockbench,
  validateTexture,
} from './core/assets.mjs';
import { AppError } from './core/errors.mjs';
export function createAssetRoutes(assets) {
  return async function route({ request, response, url, json, body, fields, send }) {
    const path = url.pathname,
      method = request.method;
    if (path === '/api/blockbench/export' && method === 'POST') {
      const input = fields(await body(request, 1024 * 1024), ['model', 'texture', 'name', 'kind']);
      if (typeof input.name !== 'string' || input.name.length > 80)
        throw new AppError(422, 'INVALID_INPUT', '请填写模型名称。');
      json(
        response,
        200,
        input.kind === 'animated_model'
          ? exportAnimatedBlockbench(input.model, input.name, input.texture)
          : exportBlockbench(input.model, input.name, input.texture),
      );
      return true;
    }
    if (path === '/api/blockbench/import' && method === 'POST') {
      const input = fields(await body(request, 1024 * 1024), [
        'model',
        'name',
        'source',
        'license',
      ]);
      const animated = !!input.model?.animations?.length;
      const model = animated
          ? importAnimatedBlockbench(input.model)
          : importBlockbench(input.model),
        entries = [
          {
            name: input.name,
            kind: animated ? 'animated_model' : 'model',
            data: model,
            source: input.source,
            license: input.license,
          },
        ];
      const source = input.model.textures?.[0]?.source;
      if (source) {
        if (typeof source !== 'string' || !source.startsWith('data:image/png;base64,'))
          throw new AppError(
            422,
            'INVALID_IMAGE',
            '仅导入 bbmodel 中嵌入的 PNG，不访问外部贴图路径。',
          );
        const img = decodePNG(Buffer.from(source.slice(22), 'base64'));
        const texture = validateTexture({
          width: img.width,
          height: img.height,
          pixels: Array.from(
            { length: img.width * img.height },
            (_, i) => '#' + img.data.subarray(i * 4, i * 4 + 4).toString('hex'),
          ),
        });
        model.texture = texture;
        entries.push({
          name: input.name.slice(0, 70) + ' 贴图',
          kind: 'texture',
          data: texture,
          source: input.source,
          license: input.license,
        });
      }
      const payload = { format: 'minemod-assets', version: 1, assets: entries };
      json(response, 201, {
        assets: assets.importPackage({ ...payload, checksum: sha256(JSON.stringify(payload)) }),
      });
      return true;
    }
    if (path === '/api/catalog' && method === 'GET') {
      json(response, 200, {
        entries: catalog.entries.map(({ assets, ...entry }) => ({
          ...entry,
          assetCount: assets.length,
        })),
      });
      return true;
    }
    const catalogMatch = path.match(/^\/api\/catalog\/([a-z0-9-]+)\/import$/);
    if (catalogMatch && method === 'POST') {
      fields(await body(request), []);
      const entry = catalog.entries.find((e) => e.id === catalogMatch[1]);
      if (!entry) throw new AppError(404, 'CATALOG_NOT_FOUND', '目录条目不存在。');
      const payload = { format: 'minemod-assets', version: 1, assets: entry.assets };
      json(response, 201, {
        assets: assets.importPackage({ ...payload, checksum: sha256(JSON.stringify(payload)) }),
      });
      return true;
    }
    if (path === '/api/asset-packages' && method === 'GET') {
      send(
        JSON.stringify(assets.exportPackage()),
        'application/json',
        'library.minemod-assets.json',
      );
      return true;
    }
    if (path === '/api/asset-packages' && method === 'POST') {
      json(response, 201, { assets: assets.importPackage(await body(request, 32 * 1024 * 1024)) });
      return true;
    }
    if (path === '/api/assets') {
      if (method === 'GET') json(response, 200, { assets: assets.list() });
      else if (method === 'POST') {
        const input = await body(request, 9 * 1024 * 1024);
        if (input?.kind !== 'image' && Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024)
          throw new AppError(413, 'BODY_TOO_LARGE', '贴图或模型请求不能超过 1 MiB。');
        json(response, 201, assets.create(input));
      } else return false;
      return true;
    }
    let match = path.match(/^\/api\/assets\/([^/]+)(?:\/(png|bbmodel|pixelize|package|bedrock))?$/);
    if (match && method === 'POST' && match[2] === 'pixelize') {
      const asset = assets.get(match[1]);
      if (asset.kind !== 'image') throw new AppError(422, 'ASSET_TYPE', '请选择图片资源。');
      const input = fields(await body(request), ['size', 'colors']);
      json(
        response,
        201,
        assets.create({
          kind: 'texture',
          name: asset.name.slice(0, 70) + ' 像素贴图',
          source: asset.source,
          license: asset.license,
          data: pixelizeImage(asset.data, input.size, input.colors),
        }),
      );
      return true;
    }
    if (match && method === 'GET') {
      const asset = assets.get(match[1]);
      if (!match[2]) json(response, 200, asset);
      else if (match[2] === 'package')
        send(
          JSON.stringify(assets.exportPackage([asset.id])),
          'application/json',
          'asset-' + asset.id + '.minemod-assets.json',
        );
      else if (match[2] === 'png' && ['texture', 'image'].includes(asset.kind))
        send(
          asset.kind === 'image' ? Buffer.from(asset.data.png, 'base64') : pngTexture(asset.data),
          'image/png',
          'texture-' + asset.id + '.png',
        );
      else if (match[2] === 'bedrock' && asset.kind === 'animated_model') {
        const texture = asset.data.texture ?? placeholderTexture();
        const data = bedrockAnimationResources(
          asset.data,
          'minemod.export',
          texture.width,
          texture.height,
        );
        send(
          zipFiles({
            'model.geo.json': JSON.stringify(data.geometry, null, 2),
            'model.animation.json': JSON.stringify(data.animations, null, 2),
            'texture.png': pngTexture(texture),
            'SOURCE.json': JSON.stringify({ source: asset.source, license: asset.license }),
          }),
          'application/zip',
          'animation-' + asset.id + '.zip',
        );
      } else if (match[2] === 'bbmodel' && ['model', 'animated_model'].includes(asset.kind))
        send(
          JSON.stringify(
            asset.kind === 'animated_model'
              ? exportAnimatedBlockbench(asset.data, asset.name)
              : exportBlockbench(asset.data, asset.name),
            null,
            2,
          ),
          'application/json',
          'model-' + asset.id + '.bbmodel',
        );
      else throw new AppError(400, 'ASSET_TYPE', '资源类型不匹配。');
      return true;
    }
    return false;
  };
}
