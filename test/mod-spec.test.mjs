import test from 'node:test';
import assert from 'node:assert/strict';
import example from '../examples/project-spec.json' with { type: 'json' };
import { validateModSpec, specHash } from '../src/core/mod-spec.mjs';

test('ModSpec accepts shaped and shapeless recipes and returns an isolated value', () => {
  assert.deepEqual(validateModSpec(example), example);
  const copy = structuredClone(example);
  copy.recipes = [
    {
      id: 'moonlight_hammer',
      type: 'crafting_shapeless',
      ingredients: ['minecraft:iron_ingot', 'minecraft:stick'],
      result: { item: 'moonlight_workshop:moonlight_hammer', count: 1 },
    },
  ];
  assert.deepEqual(validateModSpec(copy), copy);
  validateModSpec(copy).items[0].id = 'different';
  assert.equal(copy.items[0].id, 'moonlight_hammer');
  assert.equal(specHash(copy), specHash(Object.fromEntries(Object.entries(copy).reverse())));
});

test('ModSpec rejects unsupported behavior, unsafe IDs, targets and unknown fields', () => {
  const changes = [
    (s) => {
      s.modId = '../outside';
    },
    (s) => {
      s.modId = 'minecraft';
    },
    (s) => {
      s.items[0].id = 'nested/path';
    },
    (s) => {
      s.items[0].kind = 'weapon';
    },
    (s) => {
      s.items[0].maxStackSize = 65;
    },
    (s) => {
      s.items[0].maxStackSize = 1.5;
    },
    (s) => {
      s.target.minecraft = '1.20.1';
    },
    (s) => {
      s.target.java = 17;
    },
    (s) => {
      s.command = 'run';
    },
    (s) => {
      s.items[0].script = 'run';
    },
    (s) => {
      s.items.push(structuredClone(s.items[0]));
    },
    (s) => {
      s.items = [];
    },
    (s) => {
      s.displayName = ' ';
    },
    (s) => {
      s.assumptions = ['x'.repeat(501)];
    },
    (s) => {
      s.recipes = Array(65).fill(s.recipes[0]);
    },
  ];
  for (const change of changes) {
    const spec = structuredClone(example);
    change(spec);
    assert.throws(() => validateModSpec(spec), { code: 'INVALID_SPEC' });
  }
});

test('ModSpec rejects broken recipe references and ambiguous patterns', () => {
  const changes = [
    (s) => {
      s.recipes[0].key.I = 'moonlight_workshop:missing';
    },
    (s) => {
      s.recipes[0].key.I = 'other_mod:item';
    },
    (s) => {
      s.recipes[0].result.item = 'minecraft:diamond';
    },
    (s) => {
      s.recipes[0].result.count = 2;
    },
    (s) => {
      s.recipes[0].pattern = ['II', ' I '];
    },
    (s) => {
      s.recipes[0].pattern = ['   '];
    },
    (s) => {
      delete s.recipes[0].key.S;
    },
    (s) => {
      s.recipes[0].key.X = 'minecraft:stone';
    },
    (s) => {
      s.recipes.push(structuredClone(s.recipes[0]));
    },
  ];
  for (const change of changes) {
    const spec = structuredClone(example);
    change(spec);
    assert.throws(() => validateModSpec(spec), { code: 'INVALID_SPEC' });
  }
});
