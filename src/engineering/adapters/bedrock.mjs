import { bedrockLoot } from '../loot.mjs';
import {
  defaultEntityAnimation,
  validateAnimation,
  bedrockAnimationResources,
} from '../../core/animation.mjs';
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
    let data = placeholderTexture(item.textureColor ?? '#678f71', folder !== 'items');
    if (item.modelAsset) {
      const model = assets.find((a) => a.id === item.modelAsset);
      if (model?.data.texture) {
        data = model.data.texture;
        used.set(model.id, model);
      }
    }
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
    let geometry = 'minecraft:geometry.full_block';
    if (block.modelAsset) {
      const asset = assets.find((a) => a.id === block.modelAsset && a.kind === 'model');
      if (!asset)
        throw new AppError(
          422,
          'ASSET_MISSING',
          '方块模型不存在或类型错误，请选择静态立方体模型。',
        );
      used.set(asset.id, asset);
      const data = block.textureAsset
        ? assets.find((a) => a.id === block.textureAsset).data
        : asset.data.texture;
      const identifier = ns + '.block.' + block.id;
      const generated = bedrockAnimationResources(
        { ...asset.data, clips: [{ name: 'idle', duration: 1, loop: true, tracks: [] }] },
        identifier,
        data?.width ?? 16,
        data?.height ?? 16,
      );
      geometry = 'geometry.' + identifier;
      json('resource_pack/models/blocks/' + block.id + '.geo.json', generated.geometry);
    }
    json(`behavior_pack/blocks/${block.id}.json`, {
      format_version: '1.21.60',
      'minecraft:block': {
        description: { identifier: id, menu_category: { category: 'construction' } },
        components: {
          'minecraft:display_name': 'tile.' + id + '.name',
          'minecraft:geometry': geometry,
          'minecraft:material_instances': {
            '*': { texture: key, render_method: block.modelAsset ? 'alpha_test' : 'opaque' },
          },
          'minecraft:destructible_by_mining': { seconds_to_destroy: block.hardness },
          'minecraft:destructible_by_explosion': { explosion_resistance: block.resistance },
          'minecraft:light_emission': block.luminance,
          'minecraft:loot': 'loot_tables/blocks/' + block.id + '.json',
        },
      },
    });
    json(`behavior_pack/loot_tables/blocks/${block.id}.json`, bedrockLoot(spec, block, 'block'));
    localize('tile.' + id + '.name', block.displayName);
  }
  for (const entity of spec.entities ?? []) {
    const id = ns + ':' + entity.id,
      identifier = ns + '.' + entity.id,
      zombie = entity.archetype === 'zombie';
    const tex = texture(entity, 'entity');
    const textureData = entity.textureAsset
      ? assets.find((a) => a.id === entity.textureAsset).data
      : (assets.find((a) => a.id === entity.modelAsset)?.data.texture ?? null);
    let rig = defaultEntityAnimation(entity.archetype);
    if (entity.modelAsset) {
      const asset = assets.find(
        (a) => a.id === entity.modelAsset && ['model', 'animated_model'].includes(a.kind),
      );
      if (!asset) throw new AppError(422, 'ASSET_MISSING', '实体模型资源不存在或类型不匹配。');
      used.set(asset.id, asset);
      rig =
        asset.kind === 'animated_model'
          ? validateAnimation(asset.data)
          : validateAnimation({
              ...asset.data,
              clips: [{ name: 'idle', duration: 1, loop: true, tracks: [] }],
            });
    }
    const clip = entity.animationClip ?? rig.clips[0].name;
    if (!rig.clips.some((c) => c.name === clip))
      throw new AppError(422, 'ANIMATION_MISSING', '实体选择的动画片段不存在。');
    const generated = bedrockAnimationResources(
      rig,
      identifier,
      textureData?.width ?? 16,
      textureData?.height ?? 16,
    );
    json('resource_pack/models/entity/' + entity.id + '.geo.json', generated.geometry);
    json('resource_pack/animations/' + entity.id + '.animation.json', generated.animations);
    json(
      'behavior_pack/loot_tables/entities/' + entity.id + '.json',
      bedrockLoot(spec, entity, 'entity'),
    );
    json('behavior_pack/entities/' + entity.id + '.json', {
      format_version: '1.21.60',
      'minecraft:entity': {
        description: {
          identifier: id,
          is_spawnable: true,
          is_summonable: true,
          is_experimental: false,
        },
        components: {
          'minecraft:type_family': {
            family: zombie ? ['monster', 'minemod'] : ['animal', 'minemod'],
          },
          'minecraft:loot': { table: 'loot_tables/entities/' + entity.id + '.json' },
          'minecraft:health': { value: entity.health, max: entity.health },
          'minecraft:movement': { value: entity.movementSpeed },
          'minecraft:collision_box': { width: zombie ? 0.6 : 0.9, height: zombie ? 1.9 : 1.4 },
          'minecraft:physics': { has_gravity: true, has_collision: true },
          'minecraft:movement.basic': {},
          'minecraft:navigation.walk': { can_path_over_water: true, avoid_water: true },
          'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 1 },
          'minecraft:behavior.look_at_player': { priority: 8, look_distance: 6, probability: 0.02 },
          ...(zombie
            ? {
                'minecraft:attack': { damage: entity.attackDamage },
                'minecraft:behavior.nearest_attackable_target': {
                  priority: 2,
                  must_see: true,
                  entity_types: [
                    {
                      filters: { test: 'is_family', subject: 'other', value: 'player' },
                      max_dist: 16,
                    },
                  ],
                },
                'minecraft:behavior.melee_attack': {
                  priority: 3,
                  speed_multiplier: 1.2,
                  track_target: true,
                },
              }
            : {}),
        },
      },
    });
    json('resource_pack/entity/' + entity.id + '.entity.json', {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: id,
          materials: { default: 'entity_alphatest' },
          textures: { default: tex.textures },
          geometry: { default: 'geometry.' + identifier },
          animations: Object.fromEntries(
            rig.clips.map((c) => [c.name, 'animation.' + identifier + '.' + c.name]),
          ),
          scripts: {
            animate: clip === 'walk' ? [{ [clip]: 'query.modified_move_speed > 0.01' }] : [clip],
          },
          render_controllers: ['controller.render.' + identifier],
          spawn_egg: { base_color: entity.textureColor ?? '#8e62cf', overlay_color: '#ffffff' },
        },
      },
    });
    json('resource_pack/render_controllers/' + entity.id + '.json', {
      format_version: '1.10.0',
      render_controllers: {
        ['controller.render.' + identifier]: {
          geometry: 'Geometry.default',
          materials: [{ '*': 'Material.default' }],
          textures: ['Texture.default'],
        },
      },
    });
    localize('entity.' + id + '.name', entity.displayName);
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
    [...used.values()].map(({ id, name, kind, source, license, sha256, derivedFrom }) => ({
      id,
      name,
      kind,
      source,
      license,
      sha256,
      ...(derivedFrom ? { derivedFrom } : {}),
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
  const all = new Map(
    snapshot.files.map((file) => [file.path, Buffer.from(file.content, 'base64')]),
  );
  const parse = (path) => {
    const bytes = all.get(path);
    if (!bytes) throw new AppError(422, 'INVALID_PACK', '包缺少资源：' + path);
    return JSON.parse(bytes);
  };
  const textures = new Set([...all.keys()].filter((path) => path.endsWith('.png')));
  for (const [path, bytes] of all) {
    const entity = path.startsWith('behavior_pack/entities/');
    if ((!entity && !path.startsWith('behavior_pack/blocks/')) || !path.endsWith('.json')) continue;
    const components =
      JSON.parse(bytes)[entity ? 'minecraft:entity' : 'minecraft:block']?.components;
    const loot = components?.['minecraft:loot'];
    if (loot) parse('behavior_pack/' + (entity ? loot.table : loot));
  }
  const geometryIds = new Set(),
    animationIds = new Set();
  for (const [path, bytes] of all) {
    if (path.startsWith('resource_pack/models/') && path.endsWith('.json'))
      for (const model of JSON.parse(bytes)['minecraft:geometry'] ?? [])
        geometryIds.add(model.description.identifier);
    if (path.startsWith('resource_pack/animations/') && path.endsWith('.json'))
      for (const id of Object.keys(JSON.parse(bytes).animations ?? {})) animationIds.add(id);
  }
  for (const [path, bytes] of all)
    if (path.startsWith('behavior_pack/blocks/') && path.endsWith('.json')) {
      const geometry = JSON.parse(bytes)['minecraft:block']?.components?.['minecraft:geometry'];
      if (
        typeof geometry !== 'string' ||
        (geometry !== 'minecraft:geometry.full_block' && !geometryIds.has(geometry))
      )
        throw new AppError(422, 'INVALID_PACK', '方块几何引用缺失。');
    }
  for (const [path, bytes] of all)
    if (path.startsWith('resource_pack/entity/') && path.endsWith('.json')) {
      const d = JSON.parse(bytes)['minecraft:client_entity']?.description;
      if (
        !d ||
        !geometryIds.has(d.geometry?.default) ||
        !textures.has('resource_pack/' + d.textures?.default + '.png') ||
        Object.values(d.animations ?? {}).some((id) => !animationIds.has(id))
      )
        throw new AppError(422, 'INVALID_PACK', '实体几何、贴图或动画引用缺失。');
      for (const id of d.render_controllers ?? [])
        if (
          ![...all].some(
            ([p, b]) =>
              p.startsWith('resource_pack/render_controllers/') &&
              Object.hasOwn(JSON.parse(b).render_controllers ?? {}, id),
          )
        )
          throw new AppError(422, 'INVALID_PACK', '实体渲染控制器缺失。');
    }
  for (const atlas of ['item_texture', 'terrain_texture'])
    for (const entry of Object.values(
      parse('resource_pack/textures/' + atlas + '.json').texture_data ?? {},
    ))
      if (!textures.has('resource_pack/' + entry.textures + '.png'))
        throw new AppError(422, 'INVALID_PACK', '贴图集引用缺失。');
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
