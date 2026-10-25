import { gzipSync } from 'node:zlib';
import { snapshotFromFiles } from './snapshot.mjs';
import { sha256 } from '../core/archive.mjs';
import { lootEntries } from './loot.mjs';
import { AppError } from '../core/errors.mjs';

const supported = new Set(['fabric-1.20.1', 'fabric-1.21.1', 'forge-1.20.1', 'neoforge-1.21.1']);
export const supportsGameTests = (id) => supported.has(id);
const utf = (value) => {
  const b = Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(b.length);
  return Buffer.concat([length, b]);
};
const int = (value) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
};
const tag = (type, name, data) => Buffer.concat([Buffer.from([type]), utf(name), data]);
const list = (type, values) => Buffer.concat([Buffer.from([type]), int(values.length), ...values]);
function emptyStructure(version) {
  return gzipSync(
    tag(
      10,
      '',
      Buffer.concat([
        tag(3, 'DataVersion', int(version)),
        tag(9, 'size', list(3, [int(3), int(3), int(3)])),
        tag(
          9,
          'palette',
          list(10, [Buffer.concat([tag(8, 'Name', utf('minecraft:air')), Buffer.from([0])])]),
        ),
        tag(9, 'blocks', list(10, [])),
        tag(9, 'entities', list(10, [])),
        Buffer.from([0]),
      ]),
    ),
  );
}
export function withGameTests(spec, snapshot) {
  if (!supportsGameTests(snapshot.targetId)) return snapshot;
  const fabric = spec.target.loader === 'fabric',
    neo = spec.target.loader === 'neoforge',
    legacy = spec.target.minecraft === '1.20.1',
    ns = spec.modId;
  const pkg = 'studio.minemod.testing.m_' + ns;
  const files = Object.fromEntries(
    snapshot.files.map((file) => [file.path, Buffer.from(file.content, 'base64')]),
  );
  const id = (namespace, path) =>
    fabric
      ? (legacy ? 'new net.minecraft.util.Identifier' : 'net.minecraft.util.Identifier.of') +
        '("' +
        namespace +
        '","' +
        path +
        '")'
      : (neo
          ? 'net.minecraft.resources.ResourceLocation.fromNamespaceAndPath'
          : 'new net.minecraft.resources.ResourceLocation') +
        '("' +
        namespace +
        '","' +
        path +
        '")';
  const identifier = (ref) => {
    const [namespace, path] = ref.split(':');
    return id(namespace, path);
  };
  const registry = fabric
    ? 'net.minecraft.registry.Registries'
    : 'net.minecraft.core.registries.BuiltInRegistries';
  const ctx = fabric
    ? 'net.minecraft.test.TestContext'
    : 'net.minecraft.gametest.framework.GameTestHelper';
  const world = fabric ? 'context.getWorld()' : 'context.getLevel()';
  const annotation = fabric
    ? '@net.minecraft.test.GameTest(templateName = net.fabricmc.fabric.api.gametest.v1.FabricGameTest.EMPTY_STRUCTURE)'
    : '@net.minecraft.gametest.framework.GameTest(template = "empty")';
  const methods = [];
  const addCase = (name, description, checks) =>
    methods.push({
      name,
      description,
      source: `${annotation}\npublic ${fabric ? '' : 'static '}void ${name}(${ctx} context) {\n${checks}\nverified("${name}");\ncontext.${fabric ? 'complete' : 'succeed'}();\n}`,
    });
  addCase(
    'registrations',
    '物品、堆叠数、方块与实体注册',
    [
      ...spec.items.map(
        (item, index) => `var item${index}=${registry}.ITEM.get(${id(ns, item.id)});
      if(item${index}==net.minecraft.${fabric ? 'item' : 'world.item'}.Items.AIR)throw new IllegalStateException("Missing item ${item.id}");
      if(new net.minecraft.${fabric ? 'item' : 'world.item'}.ItemStack(item${index}).${fabric ? 'getMaxCount' : 'getMaxStackSize'}()!=${item.maxStackSize})throw new IllegalStateException("Stack size ${item.id}");`,
      ),
      ...(spec.blocks ?? []).map(
        (block) =>
          `if(!${registry}.BLOCK.${fabric ? 'containsId' : 'containsKey'}(${id(ns, block.id)}))throw new IllegalStateException("Missing block ${block.id}");`,
      ),
      ...(spec.entities ?? []).map(
        (entity) =>
          `if(!${registry}.ENTITY_TYPE.${fabric ? 'containsId' : 'containsKey'}(${id(ns, entity.id)}))throw new IllegalStateException("Missing entity ${entity.id}");`,
      ),
    ].join('\n'),
  );
  if (spec.recipes.length)
    addCase(
      'recipes',
      '资源加载后存在声明的配方',
      spec.recipes
        .map(
          (recipe) =>
            `if(${world}.getRecipeManager().${fabric ? 'get' : 'byKey'}(${id(ns, recipe.id)}).isEmpty())throw new IllegalStateException("Missing recipe ${recipe.id}");`,
        )
        .join('\n'),
    );
  if (spec.entities?.length)
    addCase(
      'attributes',
      '实体创建、生命与移动数值',
      spec.entities
        .map(
          (entity, index) => `{
    var entity${index}=${registry}.ENTITY_TYPE.get(${id(ns, entity.id)}).create(${world});
    if(!(entity${index} instanceof net.minecraft.${fabric ? 'entity' : 'world.entity'}.LivingEntity living))throw new IllegalStateException("Cannot create ${entity.id}");
    if(Math.abs(living.getMaxHealth()-${entity.health})>0.001)throw new IllegalStateException("Health ${entity.id}");
    if(Math.abs(living.getAttributeValue(net.minecraft.${fabric ? 'entity.attribute.EntityAttributes.GENERIC_MOVEMENT_SPEED' : 'world.entity.ai.attributes.Attributes.MOVEMENT_SPEED'})-${entity.movementSpeed})>0.001)throw new IllegalStateException("Speed ${entity.id}");
    entity${index}.discard();
  }`,
        )
        .join('\n'),
    );
  if (spec.blocks?.length)
    addCase(
      'blockdrops',
      '方块在服务器中放置，掉落引用与数量范围',
      spec.blocks
        .map((block, index) => {
          const totals = new Map();
          for (const drop of lootEntries(spec, block, 'block')) {
            const old = totals.get(drop.item) ?? { min: 0, max: 0 };
            old.min += drop.chance === 1 ? drop.min : 0;
            old.max += drop.chance > 0 ? drop.max : 0;
            totals.set(drop.item, old);
          }
          return `{
      var block${index}=${registry}.BLOCK.get(${id(ns, block.id)});
      context.${fabric ? 'setBlockState' : 'setBlock'}(1,1,1,block${index}.${fabric ? 'getDefaultState' : 'defaultBlockState'}());
      var position=context.${fabric ? 'getAbsolutePos' : 'absolutePos'}(new net.minecraft.${fabric ? 'util.math' : 'core'}.BlockPos(1,1,1));
      for(int roll=0;roll<5;roll++){
        var drops=net.minecraft.${fabric ? 'block.Block.getDroppedStacks' : 'world.level.block.Block.getDrops'}(block${index}.${fabric ? 'getDefaultState' : 'defaultBlockState'}(),${world},position,null);
        var counts=new java.util.HashMap<String,Integer>();
        for(var stack:drops)counts.merge(${registry}.ITEM.${fabric ? 'getId' : 'getKey'}(stack.getItem()).toString(),stack.getCount(),Integer::sum);
        var allowed=java.util.Set.of(${[...totals.keys()].map((ref) => JSON.stringify(ref)).join(',')});
        for(String key:counts.keySet())if(!allowed.contains(key))throw new IllegalStateException("Unexpected drop "+key);
        ${[...totals].map(([ref, bounds]) => `if(counts.getOrDefault(${JSON.stringify(ref)},0)<${bounds.min}||counts.getOrDefault(${JSON.stringify(ref)},0)>${bounds.max})throw new IllegalStateException("Drop range ${ref}");`).join('\n')}
      }
    }`;
        })
        .join('\n'),
    );
  const holder = fabric
    ? ''
    : `@${neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'}.gametest.GameTestHolder("${ns}")\n@${neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'}.gametest.PrefixGameTestTemplate(false)`;
  const source = `package ${pkg};
${holder}
public final class GeneratedGameChecks ${fabric ? 'implements net.fabricmc.fabric.api.gametest.v1.FabricGameTest' : ''} {
  private static void verified(String name) {
    try { java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("minemod.testReport","build/minemod-game-tests.jsonl")), "{\\\"name\\\":\\\""+name+"\\\",\\\"passed\\\":true}\\n", java.nio.file.StandardOpenOption.CREATE,java.nio.file.StandardOpenOption.APPEND); }
    catch(java.io.IOException error){throw new IllegalStateException("Cannot write server test receipt",error);}
  }
  ${methods.map((m) => m.source).join('\n')}
}
`;
  files['src/main/java/' + pkg.replaceAll('.', '/') + '/GeneratedGameChecks.java'] =
    Buffer.from(source);
  const task = fabric ? 'runGametest' : 'runGameTestServer';
  let gradle = files['build.gradle'].toString();
  if (fabric) {
    const version = legacy ? '1.2.13+1802ada577' : '2.0.5+6fc22b9919';
    gradle += `\ndependencies { modImplementation 'net.fabricmc.fabric-api:fabric-gametest-api-v1:${version}' }\nloom { runs { gametest { server(); vmArg '-Dfabric-api.gametest'; vmArg "-Dminemod.testReport=\${project.buildDir}/minemod-game-tests.jsonl"; runDir 'build/gametest' } } }\n`;
    const metadata = JSON.parse(files['src/main/resources/fabric.mod.json']);
    metadata.entrypoints['fabric-gametest'] = [pkg + '.GeneratedGameChecks'];
    files['src/main/resources/fabric.mod.json'] = Buffer.from(
      JSON.stringify(metadata, null, 2) + '\n',
    );
  } else {
    gradle += neo
      ? `\nneoForge { runs { gameTestServer { type = 'gameTestServer'; gameDirectory = project.file('build/gametest'); systemProperty 'neoforge.enabledGameTestNamespaces', '${ns}'; systemProperty 'minemod.testReport', project.file('build/minemod-game-tests.jsonl').absolutePath } } }\n`
      : `\nminecraft { runs { gameTestServer { workingDirectory project.file('build/gametest'); property 'forge.enabledGameTestNamespaces', '${ns}'; property 'minemod.testReport', project.file('build/minemod-game-tests.jsonl').absolutePath; mods { '${ns}' { source sourceSets.main } } } } }\n`;
    files[`src/main/resources/data/${ns}/${legacy ? 'structures' : 'structure'}/empty.nbt`] =
      emptyStructure(legacy ? 3465 : 3955);
  }
  if (neo) {
    // ModDev 2.0.148 links every PrepareRun to client asset downloads. A headless
    // GameTest run uses no asset placeholders, so give only that run an empty
    // properties input; keep the real server libraries/data and launcher intact.
    files['SERVER-ASSETS.properties'] = Buffer.from(
      '# Headless server: no client textures, sounds or asset index required.\nassets_root=build/server-assets\nasset_index=headless\n',
    );
    gradle += `\ntasks.withType(net.neoforged.moddevgradle.internal.PrepareRun).configureEach { launch -> if (launch.name.toLowerCase().contains('gametestserver')) launch.assetProperties.set(project.file('SERVER-ASSETS.properties')) }\n`;
  }
  gradle += `\ntasks.register('prepareGameTestRuntime') {
    dependsOn 'classes'
    dependsOn tasks.named('${task}').map { runTask -> runTask.taskDependencies.getDependencies(runTask) }
    doLast { configurations.runtimeClasspath.resolve(); def launch = tasks.named('${task}').get(); if (launch.hasProperty('classpath')) launch.classpath.files }
  }\n`;
  // Forge attaches the launcher as a dependency finalizer. Resolve its preparation
  // graph online, but never start Minecraft until the isolated second phase.
  gradle += `\ntasks.matching { it.name == '${task}' }.configureEach { onlyIf { !gradle.startParameter.taskNames.any { it.endsWith('prepareGameTestRuntime') } } }\n`;
  if (!fabric && !neo)
    gradle += `\ntasks.matching { it.name in ['downloadAssets', 'extractNatives'] }.configureEach {
    onlyIf { !gradle.startParameter.taskNames.any { it.endsWith('runGameTestServer') || it.endsWith('prepareGameTestRuntime') } }
  }\n`;
  files['build.gradle'] = Buffer.from(gradle);
  files['GAME-TEST-PLAN.json'] = Buffer.from(
    JSON.stringify(
      {
        version: 1,
        targetId: snapshot.targetId,
        modId: ns,
        task,
        scope: 'headless-server',
        clientVisualTested: false,
        cases: methods.map(({ name, description }) => ({ name, description })),
        testSourceSha256: sha256(source),
      },
      null,
      2,
    ),
  );
  return snapshotFromFiles({
    spec,
    files,
    targetId: snapshot.targetId,
    template: snapshot.template,
    assetIds: snapshot.assetIds,
  });
}
export function parseGameTestReceipt(bytes, plan) {
  if (bytes.length > 1024 * 1024) throw new AppError(409, 'GAME_TEST_REPORT', '服务器报告过大。');
  let rows;
  try {
    rows = bytes
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new AppError(409, 'GAME_TEST_REPORT', '服务器报告格式错误。');
  }
  const actual = new Set(rows.map((row) => row.name)),
    expected = plan.cases.map((c) => c.name);
  if (
    !expected.length ||
    rows.length !== expected.length ||
    actual.size !== rows.length ||
    rows.some((row) => row.passed !== true) ||
    expected.some((name) => !actual.has(name))
  )
    throw new AppError(409, 'GAME_TEST_REPORT', '没有取得全部预期服务器检查结果。');
  return {
    scope: 'headless-server',
    clientVisualTested: false,
    cases: plan.cases,
    passed: rows.length,
    sha256: sha256(bytes),
  };
}
