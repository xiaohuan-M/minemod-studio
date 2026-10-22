import { createHash } from 'node:crypto';
import schema from '../../schemas/mod-spec.v1.schema.json' with { type: 'json' };
import { AppError } from './errors.mjs';

export const modSpecSchema = schema;

function invalid(path, message) {
  throw new AppError(422, 'INVALID_SPEC', path + '：' + message);
}

// Evaluates the bounded subset used by our bundled schema, never user-supplied schemas.
function check(value, rule, path) {
  if (rule.$ref) return check(value, schema.$defs[rule.$ref.split('/').at(-1)], path);
  if (rule.oneOf) {
    const matching = rule.oneOf.filter((candidate) => {
      try { check(value, candidate, path); return true; } catch (error) {
        if (error.code !== 'INVALID_SPEC') throw error;
        return false;
      }
    });
    if (matching.length !== 1) invalid(path, '需要合法的有序或无序合成配方，请核对字段。');
    return;
  }
  if ('const' in rule && value !== rule.const) invalid(path, '必须为 ' + JSON.stringify(rule.const));
  if (rule.enum && !rule.enum.includes(value)) invalid(path, '不是支持的选项。');
  const type = rule.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '必须为对象。');
    const keys = Object.keys(value);
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) invalid(path + '.' + key, '缺少必填字段。');
    if (keys.length < (rule.minProperties ?? 0) || keys.length > (rule.maxProperties ?? Infinity)) invalid(path, '字段数量超出限制。');
    for (const key of keys) {
      if (rule.propertyNames) check(key, rule.propertyNames, path + '.key');
      if (Object.hasOwn(rule.properties ?? {}, key)) check(value[key], rule.properties[key], path + '.' + key);
      else if (rule.additionalProperties === false) invalid(path, '包含未支持字段。');
      else if (typeof rule.additionalProperties === 'object') check(value[key], rule.additionalProperties, path + '.value');
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) invalid(path, '必须为数组。');
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) invalid(path, '条目数量超出限制。');
    value.forEach((item, index) => check(item, rule.items, path + '[' + index + ']'));
  } else if (type === 'string' || rule.pattern) {
    if (typeof value !== 'string') invalid(path, '必须为文本。');
    if ((rule.minLength && !value.trim()) || value.length < (rule.minLength ?? 0) || value.length > (rule.maxLength ?? Infinity)) invalid(path, '文本长度超出限制。');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) invalid(path, '标识或内容格式不正确。');
  } else if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)) || value < rule.minimum || value > rule.maximum) invalid(path, '数值超出允许范围。');
  }
}

export function validateModSpec(value) {
  check(value, schema, 'spec');
  if (['minecraft', 'fabric', 'java'].includes(value.modId)) invalid('spec.modId', '请使用自己的命名空间。');
  const itemIds = new Set();
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) invalid('spec.items[' + index + '].id', '物品 ID 重复。');
    itemIds.add(item.id);
    const tool = ['sword','pickaxe','axe','shovel','hoe'].includes(item.kind);
    if (tool !== !!item.tool) invalid('spec.items[' + index + '].tool', '工具必须且只能配置工具属性。');
    if ((item.kind === 'food') !== !!item.food) invalid('spec.items[' + index + '].food', '食物必须且只能配置食物属性。');
    if (item.cooldownSeconds !== undefined && item.kind !== 'lightning_wand') invalid('spec.items[' + index + '].cooldownSeconds', '只有闪电法杖支持冷却配置。');
    if ((tool || item.kind === 'lightning_wand') && item.maxStackSize !== 1) invalid('spec.items[' + index + '].maxStackSize', '工具和法杖只能单个堆叠。');
  }
  for (const [index, block] of (value.blocks ?? []).entries()) {
    if (itemIds.has(block.id)) invalid('spec.blocks[' + index + '].id', '物品与方块 ID 必须全局唯一。');
    itemIds.add(block.id);
  }
  const recipeIds = new Set();
  function reference(ref, path, localOnly = false) {
    const [namespace, id] = ref.split(':');
    if (namespace === value.modId && itemIds.has(id)) return;
    if (!localOnly && namespace === 'minecraft') return;
    invalid(path, '只能引用已声明的本模组物品或 minecraft 物品；产物必须属于本模组。');
  }
  for (const [index, recipe] of value.recipes.entries()) {
    const path = 'spec.recipes[' + index + ']';
    if (recipeIds.has(recipe.id)) invalid(path + '.id', '配方 ID 重复。');
    recipeIds.add(recipe.id);
    reference(recipe.result.item, path + '.result.item', true);
    const output = [...value.items, ...(value.blocks ?? []).map(block=>({...block,maxStackSize:64}))].find((item) => value.modId + ':' + item.id === recipe.result.item);
    if (recipe.result.count > output.maxStackSize) invalid(path + '.result.count', '不能超过产物的最大堆叠数。');
    if (recipe.type === 'crafting_shaped') {
      if (recipe.pattern.some((row) => row.length !== recipe.pattern[0].length)) invalid(path + '.pattern', '每行宽度必须一致。');
      const used = new Set(recipe.pattern.join('').replaceAll(' ', ''));
      if (!used.size || [...used].some((key) => !Object.hasOwn(recipe.key, key)) || Object.keys(recipe.key).some((key) => !used.has(key))) invalid(path + '.key', '配方字符和原料映射必须一一对应。');
      Object.values(recipe.key).forEach((ref) => reference(ref, path + '.key'));
    } else recipe.ingredients.forEach((ref) => reference(ref, path + '.ingredients'));
  }
  return structuredClone(value);
}

export function specHash(spec) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(validateModSpec(spec)))).digest('hex');
}
