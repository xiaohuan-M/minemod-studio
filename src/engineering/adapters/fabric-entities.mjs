import { javaLoot } from '../loot.mjs';
import { pngTexture, placeholderTexture } from '../../core/assets.mjs';
import { AppError } from '../../core/errors.mjs';
import { entityMesh } from '../entity-mesh.mjs';
import { entityRendererSource } from '../entity-renderer.mjs';
/** Vanilla archetypes retain their native animation and behavior; only supported attributes are exposed. */
export function generateEntities(spec, { add, resource, getAsset, packageName, zh, en, legacy }) {
  const declarations = [],
    statements = [],
    renderers = [],
    ns = spec.modId;
  for (const entity of spec.entities ?? []) {
    const zombie = entity.archetype === 'zombie',
      type = zombie ? 'ZombieEntity' : 'CowEntity',
      field = 'ENTITY_' + entity.id;
    const name = JSON.stringify(entity.id),
      color = parseInt((entity.textureColor ?? '#8e62cf').slice(1), 16);
    declarations.push(
      `public static final net.minecraft.entity.EntityType<net.minecraft.entity.${zombie ? 'mob' : 'passive'}.${type}> ${field} = Registry.register(Registries.ENTITY_TYPE, Identifier.of(MOD_ID, ${name}), net.minecraft.entity.EntityType.Builder.<net.minecraft.entity.${zombie ? 'mob' : 'passive'}.${type}>create(net.minecraft.entity.${zombie ? 'mob' : 'passive'}.${type}::new, net.minecraft.entity.SpawnGroup.${zombie ? 'MONSTER' : 'CREATURE'}).${legacy ? 'setDimensions' : 'dimensions'}(${zombie ? '0.6f, 1.95f' : '0.9f, 1.4f'}).build(MOD_ID + ":" + ${name}));`,
    );
    statements.push(
      `net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry.register(${field}, net.minecraft.entity.${zombie ? 'mob' : 'passive'}.${type}.${zombie ? 'createZombieAttributes' : 'createCowAttributes'}().add(net.minecraft.entity.attribute.EntityAttributes.GENERIC_MAX_HEALTH, ${entity.health}).add(net.minecraft.entity.attribute.EntityAttributes.GENERIC_MOVEMENT_SPEED, ${entity.movementSpeed})${zombie ? '.add(net.minecraft.entity.attribute.EntityAttributes.GENERIC_ATTACK_DAMAGE, ' + entity.attackDamage + ')' : ''});`,
    );
    statements.push(
      `all.add(Registry.register(Registries.ITEM, Identifier.of(MOD_ID, ${JSON.stringify(entity.id + '_spawn_egg')}), new SpawnEggItem(${field}, ${color}, 16777215, new Item.Settings())));`,
    );
    for (const [lang, code] of [
      [zh, 'zh_cn'],
      [en, 'en_us'],
    ]) {
      lang['entity.' + ns + '.' + entity.id] = entity.displayName[code];
      lang['item.' + ns + '.' + entity.id + '_spawn_egg'] =
        entity.displayName[code] + (code === 'zh_cn' ? ' 刷怪蛋' : ' Spawn Egg');
    }
    resource(`assets/${ns}/models/item/${entity.id}_spawn_egg.json`, {
      parent: 'minecraft:item/template_spawn_egg',
    });
    const custom = entity.modelAsset
      ? getAsset(entity.modelAsset, ['model', 'animated_model'])
      : null;
    if (custom)
      resource(
        `assets/minemod_runtime_m_${ns}/entity/${entity.id}.json`,
        entityMesh(custom.data, custom.kind, entity.animationClip),
      );
    let texture;
    if (entity.textureAsset) {
      texture = getAsset(entity.textureAsset, 'texture').data;
      if (!custom && texture.width !== 64)
        throw new AppError(
          422,
          'ENTITY_TEXTURE',
          '实体贴图需要 64×64 PNG，并按照所选原版模型的 UV 布局绘制。',
        );
    } else if (custom?.data.texture) texture = custom.data.texture;
    else {
      const base = placeholderTexture(entity.textureColor ?? '#8e62cf', true);
      texture = {
        width: 64,
        height: 64,
        pixels: Array.from(
          { length: 4096 },
          (_, i) => base.pixels[Math.floor(Math.floor(i / 64) / 4) * 16 + Math.floor((i % 64) / 4)],
        ),
      };
    }
    add(`src/main/resources/assets/${ns}/textures/entity/${entity.id}.png`, pngTexture(texture));
    resource(`data/${ns}/loot_table/entities/${entity.id}.json`, javaLoot(spec, entity, 'entity'));
    if (custom)
      renderers.push(
        `net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry.register(GeneratedMod.${field}, context -> new studio.minemod.runtime.m_${ns}.StudioEntityRenderer<>(context,${name}));`,
      );
    else
      renderers.push(`net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry.register(GeneratedMod.${field}, context -> new net.minecraft.client.render.entity.${zombie ? 'ZombieEntityRenderer' : 'CowEntityRenderer'}(context) {
      @Override public Identifier getTexture(net.minecraft.entity.${zombie ? 'mob' : 'passive'}.${type} entity) { return Identifier.of(GeneratedMod.MOD_ID, "textures/entity/${entity.id}.png"); }
    });`);
  }
  if (spec.entities?.some((e) => e.modelAsset)) {
    const renderer = entityRendererSource(ns, { legacy });
    add(renderer.path, renderer.content);
  }
  for (const block of spec.blocks ?? [])
    if (block.modelAsset)
      renderers.push(
        `net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap.INSTANCE.putBlock(net.minecraft.registry.Registries.BLOCK.get(Identifier.of(GeneratedMod.MOD_ID, ${JSON.stringify(block.id)})), net.minecraft.client.render.RenderLayer.getCutout());`,
      );
  if (renderers.length)
    add(
      'src/main/java/' + packageName.replaceAll('.', '/') + '/GeneratedClient.java',
      `package ${packageName};
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.util.Identifier;
public final class GeneratedClient implements ClientModInitializer {
  @Override public void onInitializeClient() {
    ${renderers.join('\n    ')}
  }
}
`,
    );
  return { declarations, statements };
}
