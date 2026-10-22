import { readFileSync } from 'node:fs';
import { validateModSpec } from '../../core/mod-spec.mjs';
import { pngTexture, placeholderTexture } from '../../core/assets.mjs';
import { AppError } from '../../core/errors.mjs';
import { sha256, zipFiles, readZipEntry } from '../../core/archive.mjs';
import { snapshotFromFiles } from '../snapshot.mjs';
import template from '../../../templates/bedrock-1.21.60/manifest.json' with { type: 'json' };
function uuid(seed) {
  const s = sha256(seed);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-5${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
export function generateBedrock(input, assets = []) {
  const spec = validateModSpec(input),
    ns = spec.modId,
    files = {},
    used = new Map();
  const json = (path, value) => {
    files[path] = JSON.stringify(value, null, 2) + '\n';
  };
  const bp = uuid(ns + ':behavior'),
    rp = uuid(ns + ':resource');
  for (const [pack, type, id] of [
    ['behavior_pack', 'data', bp],
    ['resource_pack', 'resources', rp],
  ]) {
    json(pack + '/manifest.json', {
      format_version: 2,
      header: {
        name: spec.displayName,
        description: 'Created with MineMod Studio',
        uuid: id,
        version: [1, 0, 0],
        min_engine_version: [1, 21, 60],
      },
      modules: [{ type, uuid: uuid(ns + ':' + type + ':module'), version: [1, 0, 0] }],
      ...(type === 'data' ? { dependencies: [{ uuid: rp, version: [1, 0, 0] }] } : {}),
    });
  }
  const icons = {},
    terrain = {},
    blocks = { format_version: [1, 1, 0] };
  const langs = { zh_CN: [], en_US: [] };
  const texture = (item, folder) => {
    let data = placeholderTexture(item.textureColor ?? '#678f71', folder === 'blocks');
    if (item.textureAsset) {
      const asset = assets.find((a) => a.id === item.textureAsset && a.kind === 'texture');
      if (!asset) throw new AppError(422, 'ASSET_MISSING', '贴图资源不存在或类型错误。');
      data = asset.data;
      used.set(asset.id, asset);
    }
    const path = `textures/${folder}/${ns}_${item.id}`;
    files['resource_pack/' + path + '.png'] = pngTexture(data);
    return { textures: path };
  };
  const localize = (key, names) => {
    for (const [locale, lang] of [
      ['zh_CN', 'zh_cn'],
      ['en_US', 'en_us'],
    ])
      langs[locale].push(key + '=' + names[lang].replace(/[\r\n]/g, ' '));
  };
  for (const item of spec.items) {
    const id = ns + ':' + item.id,
      icon = ns + '_' + item.id;
    icons[icon] = texture(item, 'items');
    const components = {
      'minecraft:icon': { texture: icon },
      'minecraft:display_name': { value: 'item.' + id + '.name' },
      'minecraft:max_stack_size': item.maxStackSize,
    };
    if (item.food)
      Object.assign(components, {
        'minecraft:food': {
          nutrition: item.food.nutrition,
          saturation_modifier: item.food.saturation,
        },
        'minecraft:use_animation': 'eat',
        'minecraft:use_modifiers': { use_duration: 1.6, movement_modifier: 0.35 },
        'minecraft:tags': { tags: ['minecraft:is_food'] },
      });
    json(`behavior_pack/items/${item.id}.json`, {
      format_version: '1.20.50',
      'minecraft:item': {
        description: { identifier: id, menu_category: { category: 'items' } },
        components,
      },
    });
    localize('item.' + id + '.name', item.displayName);
  }
  for (const block of spec.blocks ?? []) {
    const id = ns + ':' + block.id,
      key = ns + '_' + block.id;
    terrain[key] = texture(block, 'blocks');
    blocks[id] = { textures: key, sound: 'stone' };
    json(`behavior_pack/blocks/${block.id}.json`, {
      format_version: '1.21.60',
      'minecraft:block': {
        description: { identifier: id, menu_category: { category: 'construction' } },
        components: {
          'minecraft:display_name': 'tile.' + id + '.name',
          'minecraft:geometry': 'minecraft:geometry.full_block',
          'minecraft:material_instances': { '*': { texture: key, render_method: 'opaque' } },
          'minecraft:destructible_by_mining': { seconds_to_destroy: block.hardness },
          'minecraft:destructible_by_explosion': { explosion_resistance: block.resistance },
          'minecraft:light_emission': block.luminance,
          'minecraft:loot': 'loot_tables/blocks/' + block.id + '.json',
        },
      },
    });
    json(`behavior_pack/loot_tables/blocks/${block.id}.json`, {
      pools: [{ rolls: 1, entries: [{ type: 'item', name: id, weight: 1 }] }],
    });
    localize('tile.' + id + '.name', block.displayName);
  }
  for (const recipe of spec.recipes) {
    const kind =
      recipe.type === 'crafting_shaped' ? 'minecraft:recipe_shaped' : 'minecraft:recipe_shapeless';
    const content = {
      description: { identifier: ns + ':' + recipe.id },
      tags: ['crafting_table'],
      result: recipe.result,
    };
    if (recipe.pattern) {
      content.pattern = recipe.pattern;
      content.key = Object.fromEntries(
        Object.entries(recipe.key).map(([k, item]) => [k, { item }]),
      );
    } else content.ingredients = recipe.ingredients.map((item) => ({ item }));
    json(`behavior_pack/recipes/${recipe.id}.json`, { format_version: '1.20.10', [kind]: content });
  }
  json('resource_pack/textures/item_texture.json', {
    resource_pack_name: ns,
    texture_name: 'atlas.items',
    texture_data: icons,
  });
  json('resource_pack/textures/terrain_texture.json', {
    resource_pack_name: ns,
    texture_name: 'atlas.terrain',
    padding: 8,
    num_mip_levels: 4,
    texture_data: terrain,
  });
  json('resource_pack/blocks.json', blocks);
  json('resource_pack/texts/languages.json', Object.keys(langs));
  for (const [locale, lines] of Object.entries(langs))
    files[`resource_pack/texts/${locale}.lang`] = lines.join('\n') + '\n';
  json('MODSPEC.json', spec);
  json('TEMPLATE.json', template);
  json(
    'ASSETS.json',
    [...used.values()].map(({ id, name, kind, source, license, sha256 }) => ({
      id,
      name,
      kind,
      source,
      license,
      sha256,
    })),
  );
  files['LICENSE'] = readFileSync(new URL('../../../LICENSE', import.meta.url));
  files['README.md'] =
    '# ' +
    spec.displayName.replace(/[\r\n]/g, ' ') +
    '\n\nBedrock 1.21.60 add-on. Open the .mcaddon in Minecraft, then activate BOTH behavior and resource packs in a separate test world. No experimental toggles required by this generator. Package validation does not prove in-game behavior. Block hardness is expressed as seconds_to_destroy, not Java hardness. Reimport after editing may require removing the older pack with the same UUID.\n';
  return snapshotFromFiles({
    spec,
    files,
    targetId: 'bedrock-1.21.60',
    template,
    assetIds: [...used.keys()],
  });
}
/** Package trusted generated packs; independently read back the embedded manifests. */
export function packageBedrock(snapshot) {
  if (snapshot.targetId !== 'bedrock-1.21.60')
    throw new AppError(422, 'TARGET_UNAVAILABLE', '不是 Bedrock 工程。');
  const archives = {},
    manifests = [];
  for (const pack of ['behavior_pack', 'resource_pack']) {
    const files = Object.fromEntries(
      snapshot.files
        .filter((f) => f.path.startsWith(pack + '/'))
        .map((f) => [f.path.slice(pack.length + 1), Buffer.from(f.content, 'base64')]),
    );
    for (const [path, bytes] of Object.entries(files))
      if (path.endsWith('.json')) JSON.parse(bytes);
    const zip = zipFiles(files),
      manifest = JSON.parse(readZipEntry(zip, 'manifest.json'));
    if (
      manifest.format_version !== 2 ||
      manifest.header?.min_engine_version?.join('.') !== '1.21.60'
    )
      throw new AppError(422, 'INVALID_PACK', '包 manifest 校验失败。');
    manifests.push(manifest);
    archives[pack + '.mcpack'] = zip;
  }
  if (manifests[0].dependencies?.[0]?.uuid !== manifests[1].header.uuid)
    throw new AppError(422, 'INVALID_PACK', '行为包与资源包的依赖不匹配。');
  return zipFiles(archives);
}
