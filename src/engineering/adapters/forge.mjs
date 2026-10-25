import { generateFabric } from './fabric.mjs';
import { snapshotFromFiles } from '../snapshot.mjs';
import fabric1211 from '../../../templates/fabric-1.21.1/manifest.json' with { type: 'json' };
import fabric1201 from '../../../templates/fabric-1.20.1/manifest.json' with { type: 'json' };
const json = (v) => JSON.stringify(v, null, 2) + '\n';
/** Forge/NeoForge registrations use official names; no Yarn Java code crosses this boundary. */
export function generateForge(spec, assets, template) {
  const neo = template.loader === 'neoforge',
    legacy = !neo,
    ns = spec.modId,
    pkg = 'studio.minemod.generated.m_' + ns;
  // Common Minecraft resource formats match their Fabric counterparts. Java/loader metadata are replaced.
  const shared = generateFabric(spec, assets, legacy ? fabric1201 : fabric1211);
  const files = Object.fromEntries(
    shared.files
      .filter(
        (f) =>
          !f.path.endsWith('.java') &&
          !f.path.endsWith('fabric.mod.json') &&
          f.path !== 'FABRIC-TEMPLATE-LICENSE',
      )
      .map((f) => [f.path, Buffer.from(f.content, 'base64')]),
  );
  const add = (path, content) => {
    files[path] = Buffer.from(content);
  };
  add('TEMPLATE.json', json(template));
  add('MODSPEC.json', json(spec));
  add(
    'settings.gradle',
    `pluginManagement { repositories { gradlePluginPortal(); maven { url = 'https://maven.${neo ? 'neoforged.net/releases' : 'minecraftforge.net'}/' } } }\nrootProject.name = '${ns}'\n`,
  );
  add(
    'build.gradle',
    neo
      ? `plugins { id 'java-library'; id 'net.neoforged.moddev' version '${template.pluginVersion}' }
version = '1.0.0'
group = '${pkg}'
base { archivesName = '${ns}' }
java.toolchain.languageVersion = JavaLanguageVersion.of(21)
neoForge {
  enable { version = '${template.loaderVersion}'; disableRecompilation = true }
  mods { '${ns}' { sourceSet sourceSets.main } }
}
tasks.withType(JavaCompile).configureEach { options.compilerArgs += ['-proc:none']; options.encoding = 'UTF-8'; options.release = 21 }
jar { from('LICENSE') }
`
      : `plugins { id 'java'; id 'net.minecraftforge.gradle' version '${template.pluginVersion}' }
version = '1.0.0'
group = '${pkg}'
base { archivesName = '${ns}' }
java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
minecraft { mappings channel: 'official', version: '1.20.1'; copyIdeResources = true }
repositories { mavenCentral() }
dependencies { minecraft 'net.minecraftforge:forge:1.20.1-${template.loaderVersion}' }
tasks.withType(JavaCompile).configureEach { options.compilerArgs += ['-proc:none']; options.encoding = 'UTF-8'; options.release = 17 }
jar { from('LICENSE'); finalizedBy 'reobfJar' }
`,
  );
  const dep = neo ? 'neoforge' : 'forge',
    modfile = neo ? 'neoforge.mods.toml' : 'mods.toml';
  add(
    'src/main/resources/META-INF/' + modfile,
    `modLoader = "javafml"
loaderVersion = "[${neo ? '4' : '47'},)"
license = "MIT"
[[mods]]
modId = "${ns}"
version = "1.0.0"
displayName = ${JSON.stringify(spec.displayName)}
description = "Created with MineMod Studio"
[[dependencies.${ns}]]
modId = "${dep}"
${neo ? 'type = "required"' : 'mandatory = true'}
versionRange = "[${template.loaderVersion},)"
ordering = "NONE"
side = "BOTH"
[[dependencies.${ns}]]
modId = "minecraft"
${neo ? 'type = "required"' : 'mandatory = true'}
versionRange = "[${template.minecraft}]"
ordering = "NONE"
side = "BOTH"
`,
  );
  add(
    'src/main/resources/minemod-target.json',
    json({ modId: ns, target: spec.target, template: template.id }),
  );
  const forge = neo ? 'net.neoforged.neoforge' : 'net.minecraftforge',
    fml = neo ? 'net.neoforged.fml' : 'net.minecraftforge.fml',
    bus = neo ? 'net.neoforged.bus.api' : 'net.minecraftforge.eventbus.api';
  const fields = [],
    attributeStatements = [],
    renderers = [];
  const item = (id, expr) =>
    fields.push(
      `public static final java.util.function.Supplier<Item> ITEM_${id} = ITEMS.register("${id}", () -> ${expr});`,
    );
  const material = {
      wood: 'WOOD',
      stone: 'STONE',
      iron: 'IRON',
      gold: 'GOLD',
      diamond: 'DIAMOND',
      netherite: 'NETHERITE',
    },
    classes = {
      sword: 'SwordItem',
      pickaxe: 'PickaxeItem',
      axe: 'AxeItem',
      shovel: 'ShovelItem',
      hoe: 'HoeItem',
    };
  for (const i of spec.items) {
    let props = `new Item.Properties().stacksTo(${i.maxStackSize})`,
      expr;
    if (i.food)
      props += `.food(new net.minecraft.world.food.FoodProperties.Builder().nutrition(${i.food.nutrition}).${neo ? 'saturationModifier' : 'saturationMod'}(${i.food.saturation}f).build())`;
    expr = `new Item(${props})`;
    if (i.tool) {
      const type = classes[i.kind],
        tier = 'Tiers.' + material[i.tool.material];
      expr = legacy
        ? `new ${type}(${tier}, ${i.tool.attackDamage}, ${i.tool.attackSpeed}f, new Item.Properties())`
        : `new ${type}(${tier}, new Item.Properties().attributes(${type}.createAttributes(${tier}, ${i.tool.attackDamage}, ${i.tool.attackSpeed}f)))`;
    }
    if (i.kind === 'lightning_wand')
      expr = `new LightningWand(new Item.Properties().stacksTo(1), ${(i.cooldownSeconds ?? 3) * 20})`;
    item(i.id, expr);
  }
  for (const b of spec.blocks ?? []) {
    fields.push(
      `public static final java.util.function.Supplier<Block> BLOCK_${b.id} = BLOCKS.register("${b.id}", () -> new Block(net.minecraft.world.level.block.state.BlockBehaviour.Properties.of().strength(${b.hardness}f, ${b.resistance}f).lightLevel(state -> ${b.luminance})));`,
    );
    item(b.id, `new BlockItem(BLOCK_${b.id}.get(), new Item.Properties())`);
  }
  for (const e of spec.entities ?? []) {
    const zombie = e.archetype === 'zombie',
      type = zombie
        ? 'net.minecraft.world.entity.monster.Zombie'
        : 'net.minecraft.world.entity.animal.Cow',
      short = zombie ? 'Zombie' : 'Cow',
      color = parseInt((e.textureColor ?? '#8e62cf').slice(1), 16);
    fields.push(
      `public static final java.util.function.Supplier<EntityType<${type}>> ENTITY_${e.id} = ENTITIES.register("${e.id}", () -> EntityType.Builder.<${type}>of(${type}::new, MobCategory.${zombie ? 'MONSTER' : 'CREATURE'}).sized(${zombie ? '0.6f, 1.95f' : '0.9f, 1.4f'}).build(MOD_ID + ":${e.id}"));`,
    );
    item(
      e.id + '_spawn_egg',
      `new ${forge}.common.${neo ? 'DeferredSpawnEggItem' : 'ForgeSpawnEggItem'}(ENTITY_${e.id}, ${color}, 16777215, new Item.Properties())`,
    );
    attributeStatements.push(
      `event.put(ENTITY_${e.id}.get(), ${type}.createAttributes().add(net.minecraft.world.entity.ai.attributes.Attributes.MAX_HEALTH, ${e.health}).add(net.minecraft.world.entity.ai.attributes.Attributes.MOVEMENT_SPEED, ${e.movementSpeed})${zombie ? '.add(net.minecraft.world.entity.ai.attributes.Attributes.ATTACK_DAMAGE, ' + e.attackDamage + ')' : ''}.build());`,
    );
    renderers.push(`event.registerEntityRenderer(GeneratedMod.ENTITY_${e.id}.get(), context -> new net.minecraft.client.renderer.entity.${short}Renderer(context) {
      @Override public net.minecraft.resources.ResourceLocation getTextureLocation(${type} entity) { return ${neo ? 'net.minecraft.resources.ResourceLocation.fromNamespaceAndPath' : 'new net.minecraft.resources.ResourceLocation'}(GeneratedMod.MOD_ID, "textures/entity/${e.id}.png"); }
    });`);
  }
  add(
    'src/main/java/' + pkg.replaceAll('.', '/') + '/GeneratedMod.java',
    `package ${pkg};
import ${fml}.common.Mod;
import ${bus}.IEventBus;
import ${forge}.registries.DeferredRegister;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.*;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.network.chat.Component;
@Mod(GeneratedMod.MOD_ID)
public final class GeneratedMod {
  public static final String MOD_ID = "${ns}";
  public static final DeferredRegister<Item> ITEMS = DeferredRegister.create(Registries.ITEM, MOD_ID);
  public static final DeferredRegister<Block> BLOCKS = DeferredRegister.create(Registries.BLOCK, MOD_ID);
  public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create(Registries.ENTITY_TYPE, MOD_ID);
  public static final DeferredRegister<CreativeModeTab> TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, MOD_ID);
  ${fields.join('\n  ')}
  static { TABS.register("main", () -> CreativeModeTab.builder().title(Component.translatable("itemGroup." + MOD_ID)).icon(() -> new ItemStack(ITEM_${spec.items[0].id}.get())).displayItems((parameters, output) -> ITEMS.getEntries().forEach(entry -> output.accept(entry.get()))).build()); }
  public GeneratedMod(${neo ? `IEventBus modBus, ${fml}.ModContainer container` : ''}) {
    ${neo ? '' : `IEventBus modBus = ${fml}.javafmlmod.FMLJavaModLoadingContext.get().getModEventBus();`}
    BLOCKS.register(modBus); ITEMS.register(modBus); ENTITIES.register(modBus); TABS.register(modBus);
    modBus.addListener(this::attributes);
  }
  private void attributes(${forge}.event.entity.EntityAttributeCreationEvent event) {
    ${attributeStatements.join('\n    ')}
  }
}
`,
  );
  if (renderers.length)
    add(
      'src/main/java/' + pkg.replaceAll('.', '/') + '/GeneratedClient.java',
      `package ${pkg};
import ${bus}.SubscribeEvent;
import ${neo ? 'net.neoforged.api.distmarker' : 'net.minecraftforge.api.distmarker'}.Dist;
${neo ? '@net.neoforged.fml.common.EventBusSubscriber(modid = GeneratedMod.MOD_ID, bus = net.neoforged.fml.common.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)' : '@net.minecraftforge.fml.common.Mod.EventBusSubscriber(modid = GeneratedMod.MOD_ID, bus = net.minecraftforge.fml.common.Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)'}
public final class GeneratedClient {
  @SubscribeEvent public static void renderers(${forge}.client.event.EntityRenderersEvent.RegisterRenderers event) {
    ${renderers.join('\n    ')}
  }
}
`,
    );
  if (spec.items.some((i) => i.kind === 'lightning_wand'))
    add(
      'src/main/java/' + pkg.replaceAll('.', '/') + '/LightningWand.java',
      `package ${pkg};
import net.minecraft.world.item.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LightningBolt;
import net.minecraft.world.level.Level;
import net.minecraft.server.level.ServerLevel;
public final class LightningWand extends Item {
  private final int cooldown;
  public LightningWand(Properties properties, int cooldown) { super(properties); this.cooldown = cooldown; }
  @Override public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
    ItemStack stack = player.getItemInHand(hand);
    if (level instanceof ServerLevel server && !player.getCooldowns().isOnCooldown(this)) {
      LightningBolt bolt = EntityType.LIGHTNING_BOLT.create(server);
      if (bolt != null) { bolt.setPos(player.pick(24, 0, false).getLocation()); server.addFreshEntity(bolt); }
      player.getCooldowns().addCooldown(this, cooldown);
    }
    return InteractionResultHolder.sidedSuccess(stack, level.isClientSide());
  }
}
`,
    );
  add(
    'README.md',
    `# ${spec.displayName.replace(/[\r\n]/g, ' ')}\n\n${template.loader} ${template.loaderVersion} / Minecraft ${template.minecraft} / Java ${template.java}. Independently generated declarative sources. Review MODSPEC.json, ASSETS.json and TEMPLATE.json.\n\nBuild: ./gradlew --no-daemon build (Windows: gradlew.bat build). Requires network for first dependency resolution. Install the matching ${template.loader} loader, then put the mod JAR into a separate test instance mods folder. Do not install Fabric API for this target. Compilation does not prove gameplay. Entity archetypes retain vanilla behavior and animation; no custom skeleton support.\n`,
  );
  return snapshotFromFiles({
    spec,
    files,
    targetId: template.loader + '-' + template.minecraft,
    template,
    assetIds: shared.assetIds,
  });
}
