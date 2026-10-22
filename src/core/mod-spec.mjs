import { hasVanillaItem } from './registries.mjs';
import { createHash } from 'node:crypto';
import { identifyTarget } from './targets.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../schemas/mod-spec.v1.schema.json' with { type: 'json' };
import { AppError } from './errors.mjs';

export const modSpecSchema = schema;

function invalid(path, message) {
  throw new AppError(422, 'INVALID_SPEC', path + '：' + message);
}

const validateStructure = new Ajv2020({
  strict: false,
  strictNumbers: true,
  ownProperties: true,
}).compile(schema);

export function validateModSpec(value, { checkVanilla = true } = {}) {
  if (!validateStructure(value)) {
    const error = validateStructure.errors[0];
    invalid('spec' + error.instancePath.replaceAll('/', '.'), '结构不符合规格：' + error.message);
  }
  for (const name of [
    value.displayName,
    ...value.items.flatMap((item) => Object.values(item.displayName)),
    ...(value.blocks ?? []).flatMap((block) => Object.values(block.displayName)),
    ...(value.entities ?? []).flatMap((entity) => Object.values(entity.displayName)),
    ...value.assumptions,
  ]) {
    if (!name.trim()) invalid('spec', '名称和假设不能只包含空白。');
  }
  if (!identifyTarget(value.target)?.enabled)
    invalid('spec.target', '没有匹配的版本、加载器和 Java 组合。');
  if (
    value.target.edition === 'bedrock' &&
    value.items.some((item) => !['basic_item', 'food'].includes(item.kind) || item.modelAsset)
  )
    invalid(
      'spec.items',
      '此 Bedrock 适配器支持普通物品、食物、方块、贴图和配方；工具、法杖与 Java 物品模型请使用 Fabric。',
    );
  if (['minecraft', 'fabric', 'java'].includes(value.modId))
    invalid('spec.modId', '请使用自己的命名空间。');
  const itemIds = new Set();
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) invalid('spec.items[' + index + '].id', '物品 ID 重复。');
    itemIds.add(item.id);
    const tool = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].includes(item.kind);
    if (tool !== !!item.tool)
      invalid('spec.items[' + index + '].tool', '工具必须且只能配置工具属性。');
    if ((item.kind === 'food') !== !!item.food)
      invalid('spec.items[' + index + '].food', '食物必须且只能配置食物属性。');
    if (item.cooldownSeconds !== undefined && item.kind !== 'lightning_wand')
      invalid('spec.items[' + index + '].cooldownSeconds', '只有闪电法杖支持冷却配置。');
    if ((tool || item.kind === 'lightning_wand') && item.maxStackSize !== 1)
      invalid('spec.items[' + index + '].maxStackSize', '工具和法杖只能单个堆叠。');
  }
  for (const [index, block] of (value.blocks ?? []).entries()) {
    if (itemIds.has(block.id))
      invalid('spec.blocks[' + index + '].id', '物品与方块 ID 必须全局唯一。');
    itemIds.add(block.id);
  }
  const entityIds = new Set();
  if (value.target.edition === 'bedrock' && value.entities?.length)
    invalid('spec.entities', '此 Bedrock 适配器尚不支持实体，请使用 Fabric。');
  for (const entity of value.entities ?? []) {
    if (entityIds.has(entity.id) || itemIds.has(entity.id + '_spawn_egg'))
      invalid('spec.entities', '实体 ID 重复或刷怪蛋 ID 与物品冲突。');
    if (entity.archetype === 'cow' && entity.attackDamage !== 0)
      invalid('spec.entities', '牛是被动生物，攻击伤害必须为 0。');
    entityIds.add(entity.id);
  }
  const recipeIds = new Set();
  function reference(ref, path, localOnly = false) {
    const [namespace, id] = ref.split(':');
    if (namespace === value.modId && itemIds.has(id)) return;
    if (!localOnly && namespace === 'minecraft') {
      if (checkVanilla && !hasVanillaItem(value.target, id))
        invalid(path, '当前游戏版本的原版物品注册表中没有 ' + ref + '。');
      return;
    }
    invalid(path, '只能引用已声明的本模组物品或 minecraft 物品；产物必须属于本模组。');
  }
  for (const [index, recipe] of value.recipes.entries()) {
    const path = 'spec.recipes[' + index + ']';
    if (recipeIds.has(recipe.id)) invalid(path + '.id', '配方 ID 重复。');
    recipeIds.add(recipe.id);
    reference(recipe.result.item, path + '.result.item', true);
    const output = [
      ...value.items,
      ...(value.blocks ?? []).map((block) => ({ ...block, maxStackSize: 64 })),
    ].find((item) => value.modId + ':' + item.id === recipe.result.item);
    if (recipe.result.count > output.maxStackSize)
      invalid(path + '.result.count', '不能超过产物的最大堆叠数。');
    if (recipe.type === 'crafting_shaped') {
      if (recipe.pattern.some((row) => row.length !== recipe.pattern[0].length))
        invalid(path + '.pattern', '每行宽度必须一致。');
      const used = new Set(recipe.pattern.join('').replaceAll(' ', ''));
      if (
        !used.size ||
        [...used].some((key) => !Object.hasOwn(recipe.key, key)) ||
        Object.keys(recipe.key).some((key) => !used.has(key))
      )
        invalid(path + '.key', '配方字符和原料映射必须一一对应。');
      Object.values(recipe.key).forEach((ref) => reference(ref, path + '.key'));
    } else recipe.ingredients.forEach((ref) => reference(ref, path + '.ingredients'));
  }
  return structuredClone(value);
}

export function specHash(spec) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(canonical(validateModSpec(spec, { checkVanilla: false }))))
    .digest('hex');
}
