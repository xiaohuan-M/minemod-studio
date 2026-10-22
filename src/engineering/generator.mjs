import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateModSpec, specHash } from '../core/mod-spec.mjs';
import { pngTexture, placeholderTexture, validateModel } from '../core/assets.mjs';
import { sha256, safeArchivePath } from '../core/archive.mjs';
import { AppError } from '../core/errors.mjs';
import template from '../../templates/fabric-1.21.1/manifest.json' with { type: 'json' };
export const TEMPLATE = Object.freeze(template);
const templateRoot = fileURLToPath(new URL('../../templates/fabric-1.21.1/', import.meta.url));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const literal = (value) => JSON.stringify(value).replaceAll('\\u2028', '\\u2028');

export function generateWorkspace(input, assets = []) {
  const spec = validateModSpec(input),
    files = {};
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const used = new Map();
  const add = (path, content) => {
    safeArchivePath(path);
    files[path] = Buffer.from(content);
  };
  const getAsset = (id, kind) => {
    const asset = assetMap.get(id);
    if (!asset || asset.kind !== kind)
      throw new AppError(
        422,
        'ASSET_MISSING',
        '规格引用的资源不存在或类型不匹配，请重新选择资源。',
      );
    used.set(id, asset);
    return asset;
  };
  const resource = (path, data) => add('src/main/resources/' + path, json(data));
  const ns = spec.modId,
    packageName = 'studio.minemod.generated.m_' + ns;
  for (const path of [
    'gradlew',
    'gradlew.bat',
    'gradle/wrapper/gradle-wrapper.jar',
    'gradle/wrapper/gradle-wrapper.properties',
    'GRADLE-LICENSE',
    'FABRIC-TEMPLATE-LICENSE',
  ])
    add(path, readFileSync(join(templateRoot, path)));
  if (sha256(files['gradle/wrapper/gradle-wrapper.jar']) !== template.wrapperSha256)
    throw new AppError(
      500,
      'TEMPLATE_INTEGRITY',
      'Gradle wrapper 校验失败，请重新安装官方模板文件。',
    );
  add('LICENSE', readFileSync(new URL('../../LICENSE', import.meta.url)));
  add(
    'settings.gradle',
    `pluginManagement { repositories { maven { url = 'https://maven.fabricmc.net/' }; mavenCentral(); gradlePluginPortal() } }\nrootProject.name = '${ns}'\n`,
  );
  add(
    'gradle.properties',
    'org.gradle.jvmargs=-Xmx2G\norg.gradle.parallel=false\norg.gradle.workers.max=2\norg.gradle.daemon=false\n',
  );
  add(
    'build.gradle',
    `plugins { id 'fabric-loom' version '${template.loom}' }
version = '1.0.0'
group = '${packageName}'
base { archivesName = '${ns}' }
repositories { mavenCentral() }
dependencies {
  minecraft 'com.mojang:minecraft:${template.minecraft}'
  mappings 'net.fabricmc:yarn:${template.yarn}:v2'
  modImplementation 'net.fabricmc:fabric-loader:${template.loader}'
  modImplementation 'net.fabricmc.fabric-api:fabric-api:${template.fabricApi}'
}
java { withSourcesJar(); sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
tasks.withType(JavaCompile).configureEach { options.release = 21; options.encoding = 'UTF-8' }
jar { from('LICENSE') { rename { 'LICENSE_${ns}' } } }
`,
  );
  resource('fabric.mod.json', {
    schemaVersion: 1,
    id: ns,
    version: '1.0.0',
    name: spec.displayName,
    description: 'Created with MineMod Studio. See MODSPEC.json for design assumptions.',
    authors: ['MineMod Studio user'],
    license: 'MIT',
    environment: '*',
    entrypoints: { main: [packageName + '.GeneratedMod'] },
    depends: {
      fabricloader: '>=' + template.loader,
      minecraft: template.minecraft,
      java: '>=21',
      'fabric-api': '*',
    },
  });
  resource('pack.mcmeta', { pack: { pack_format: 34, description: spec.displayName } });
  const zh = {},
    en = {};
  zh['itemGroup.' + ns] = spec.displayName;
  en['itemGroup.' + ns] = spec.displayName;
  const statements = [];
  const material = {
    wood: 'WOOD',
    stone: 'STONE',
    iron: 'IRON',
    gold: 'GOLD',
    diamond: 'DIAMOND',
    netherite: 'NETHERITE',
  };
  const classes = {
    sword: 'SwordItem',
    pickaxe: 'PickaxeItem',
    axe: 'AxeItem',
    shovel: 'ShovelItem',
    hoe: 'HoeItem',
  };
  for (const item of spec.items) {
    let expression = `new Item(new Item.Settings().maxCount(${item.maxStackSize}))`;
    if (item.kind === 'food')
      expression = `new Item(new Item.Settings().maxCount(${item.maxStackSize}).food(new FoodComponent.Builder().nutrition(${item.food.nutrition}).saturationModifier(${item.food.saturation}f).build()))`;
    if (item.tool) {
      const type = classes[item.kind],
        mat = 'ToolMaterials.' + material[item.tool.material];
      expression = `new ${type}(${mat}, new Item.Settings().attributeModifiers(${type}.createAttributeModifiers(${mat}, ${item.tool.attackDamage}, ${item.tool.attackSpeed}f)))`;
    }
    if (item.kind === 'lightning_wand')
      expression = `new LightningWand(new Item.Settings().maxCount(1), ${(item.cooldownSeconds ?? 3) * 20})`;
    statements.push(
      `all.add(Registry.register(Registries.ITEM, Identifier.of(MOD_ID, ${literal(item.id)}), ${expression}));`,
    );
    zh['item.' + ns + '.' + item.id] = item.displayName.zh_cn;
    en['item.' + ns + '.' + item.id] = item.displayName.en_us;
    const texture = item.textureAsset
      ? getAsset(item.textureAsset, 'texture').data
      : placeholderTexture(item.textureColor);
    add(`src/main/resources/assets/${ns}/textures/item/${item.id}.png`, pngTexture(texture));
    const model = item.modelAsset
      ? {
          ...validateModel(getAsset(item.modelAsset, 'model').data),
          textures: { 0: ns + ':item/' + item.id },
        }
      : {
          parent:
            'minecraft:item/' +
            (item.tool || item.kind === 'lightning_wand' ? 'handheld' : 'generated'),
          textures: { layer0: ns + ':item/' + item.id },
        };
    resource(`assets/${ns}/models/item/${item.id}.json`, model);
  }
  for (const block of spec.blocks ?? []) {
    statements.push(
      `Block b_${block.id} = Registry.register(Registries.BLOCK, Identifier.of(MOD_ID, ${literal(block.id)}), new Block(AbstractBlock.Settings.create().strength(${block.hardness}f, ${block.resistance}f).luminance(state -> ${block.luminance})));`,
    );
    statements.push(
      `all.add(Registry.register(Registries.ITEM, Identifier.of(MOD_ID, ${literal(block.id)}), new BlockItem(b_${block.id}, new Item.Settings())));`,
    );
    zh['block.' + ns + '.' + block.id] = block.displayName.zh_cn;
    en['block.' + ns + '.' + block.id] = block.displayName.en_us;
    const texture = block.textureAsset
      ? getAsset(block.textureAsset, 'texture').data
      : placeholderTexture(block.textureColor ?? '#678f71', true);
    add(`src/main/resources/assets/${ns}/textures/block/${block.id}.png`, pngTexture(texture));
    resource(`assets/${ns}/blockstates/${block.id}.json`, {
      variants: { '': { model: ns + ':block/' + block.id } },
    });
    resource(`assets/${ns}/models/block/${block.id}.json`, {
      parent: 'minecraft:block/cube_all',
      textures: { all: ns + ':block/' + block.id },
    });
    resource(`assets/${ns}/models/item/${block.id}.json`, { parent: ns + ':block/' + block.id });
    resource(`data/${ns}/loot_table/blocks/${block.id}.json`, {
      type: 'minecraft:block',
      pools: [
        {
          rolls: 1,
          entries: [{ type: 'minecraft:item', name: ns + ':' + block.id }],
          conditions: [{ condition: 'minecraft:survives_explosion' }],
        },
      ],
    });
  }
  resource(`assets/${ns}/lang/zh_cn.json`, zh);
  resource(`assets/${ns}/lang/en_us.json`, en);
  for (const recipe of spec.recipes) {
    const ingredients =
      recipe.type === 'crafting_shaped' ? Object.values(recipe.key) : recipe.ingredients;
    const content = {
      type: 'minecraft:' + recipe.type,
      category: 'misc',
      ...(recipe.type === 'crafting_shaped'
        ? {
            pattern: recipe.pattern,
            key: Object.fromEntries(
              Object.entries(recipe.key).map(([key, item]) => [key, { item }]),
            ),
          }
        : { ingredients: recipe.ingredients.map((item) => ({ item })) }),
      result: { id: recipe.result.item, count: recipe.result.count },
    };
    resource(`data/${ns}/recipe/${recipe.id}.json`, content);
    resource(`data/${ns}/advancement/recipes/${recipe.id}.json`, {
      parent: 'minecraft:recipes/root',
      criteria: {
        has_ingredient: {
          trigger: 'minecraft:inventory_changed',
          conditions: { items: [{ items: [ingredients[0]] }] },
        },
        has_the_recipe: {
          trigger: 'minecraft:recipe_unlocked',
          conditions: { recipe: ns + ':' + recipe.id },
        },
      },
      requirements: [['has_ingredient', 'has_the_recipe']],
      rewards: { recipes: [ns + ':' + recipe.id] },
    });
  }
  add(
    'src/main/java/' + packageName.replaceAll('.', '/') + '/GeneratedMod.java',
    `package ${packageName};
import java.util.ArrayList;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.minecraft.block.Block;
import net.minecraft.block.AbstractBlock;
import net.minecraft.component.type.FoodComponent;
import net.minecraft.item.*;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
public final class GeneratedMod implements ModInitializer {
  public static final String MOD_ID = ${literal(ns)};
  @Override public void onInitialize() {
    final ArrayList<Item> all = new ArrayList<>();
    ${statements.join('\n    ')}
    Registry.register(Registries.ITEM_GROUP, Identifier.of(MOD_ID, "main"), FabricItemGroup.builder()
      .displayName(Text.translatable("itemGroup." + MOD_ID)).icon(() -> new ItemStack(all.getFirst()))
      .entries((context, entries) -> all.forEach(item -> entries.add(item))).build());
  }
}
`,
  );
  if (spec.items.some((item) => item.kind === 'lightning_wand'))
    add(
      'src/main/java/' + packageName.replaceAll('.', '/') + '/LightningWand.java',
      `package ${packageName};
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.LightningEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.world.World;
public final class LightningWand extends Item {
  private final int cooldown;
  public LightningWand(Settings settings, int cooldown) { super(settings); this.cooldown = cooldown; }
  @Override public TypedActionResult<ItemStack> use(World world, PlayerEntity user, Hand hand) {
    ItemStack stack = user.getStackInHand(hand);
    if (world instanceof ServerWorld server && !user.getItemCooldownManager().isCoolingDown(this)) {
      LightningEntity lightning = EntityType.LIGHTNING_BOLT.create(server);
      if (lightning != null) { lightning.refreshPositionAfterTeleport(user.raycast(24, 0, false).getPos()); server.spawnEntity(lightning); }
      user.getItemCooldownManager().set(this, cooldown);
    }
    return TypedActionResult.success(stack, world.isClient());
  }
}
`,
    );
  add('MODSPEC.json', json(spec));
  add('TEMPLATE.json', json(template));
  add(
    'ASSETS.json',
    json(
      [...used.values()].map(({ id, name, kind, source, license, sha256: hash }) => ({
        id,
        name,
        kind,
        source,
        license,
        sha256: hash,
      })),
    ),
  );
  add(
    'README.md',
    `# ${spec.displayName.replaceAll('\n', ' ')}\n\nGenerated by MineMod Studio; Fabric ${template.minecraft}, Loader ${template.loader}, Fabric API ${template.fabricApi}, Java 21, Gradle ${template.gradle}.\n\nReview MODSPEC.json, TEMPLATE.json and all sources before building. Default textures are procedural placeholders, not AI art. Asset attribution is listed in ASSETS.json.\n\nBuild with JDK 21: chmod +x gradlew && ./gradlew --no-daemon build\nWindows: gradlew.bat --no-daemon build\n\nFirst build downloads locked dependencies. Successful compilation does not prove in-game behavior. Install matching Fabric Loader and Fabric API in a separate test instance, then put the verified mod JAR into mods/. Find content in the custom creative tab. Verify names, recipes, block drops and any right-click behavior. Never overwrite an existing world automatically.\n`,
  );
  const entries = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      encoding: 'base64',
      content: bytes.toString('base64'),
    }));
  const hash = sha256(
    JSON.stringify(entries.map(({ path, size, sha256: hash }) => ({ path, size, sha256: hash }))),
  );
  return {
    hash,
    specHash: specHash(spec),
    modId: ns,
    displayName: spec.displayName,
    template: structuredClone(template),
    files: entries,
    assetIds: [...used.keys()],
  };
}
export function workspaceFiles(snapshot) {
  return Object.fromEntries(
    snapshot.files.map((file) => [file.path, Buffer.from(file.content, 'base64')]),
  );
}
export function diffWorkspaces(previous, next) {
  const before = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  const after = new Map(next.files.map((file) => [file.path, file]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((path) => before.get(path)?.sha256 !== after.get(path)?.sha256)
    .map((path) => ({
      path,
      change: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'modified',
      before: before.get(path)?.sha256 ?? null,
      after: after.get(path)?.sha256 ?? null,
    }));
}
