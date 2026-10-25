import test from 'node:test';
import assert from 'node:assert/strict';
import example from '../examples/full-workshop.json' with { type: 'json' };
import { validateModSpec, specHash } from '../src/core/mod-spec.mjs';
import { TARGETS } from '../src/core/targets.ts';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { packageBedrock } from '../src/engineering/adapters/bedrock.mjs';
import { readZipEntry } from '../src/core/archive.mjs';

test('loot validates references, counts, probabilities and entity-only conditions without altering legacy hashes', () => {
  const base = structuredClone(example);
  for (const mutation of [
    (s) => {
      s.blocks[0].loot[0].item = 'full_workshop:absent';
    },
    (s) => {
      s.blocks[0].loot[0].item = 'minecraft:nonexistent_drop';
    },
    (s) => {
      s.blocks[0].loot[0].min = 4;
    },
    (s) => {
      s.entities[0].loot[0].chance = 1.1;
    },
    (s) => {
      s.entities[0].loot[0].chance = NaN;
    },
    (s) => {
      s.blocks[0].loot[0].playerOnly = false;
    },
    (s) => {
      s.entities[0].loot = Array(9).fill(s.entities[0].loot[0]);
    },
    (s) => {
      s.entities[0].loot[0].command = 'execute';
    },
    (s) => {
      s.entities[0].loot[0].item = 'full_workshop:sword';
      s.entities[0].loot[0].max = 2;
    },
  ]) {
    const s = structuredClone(base);
    mutation(s);
    assert.throws(() => validateModSpec(s), { code: 'INVALID_SPEC' });
  }
  for (const owner of [...base.blocks, ...base.entities]) delete owner.loot;
  const hash = specHash(base);
  assert.equal(specHash(validateModSpec(base)), hash);
  assert.equal(Object.hasOwn(validateModSpec(base).blocks[0], 'loot'), false);
  base.blocks[0].loot = [];
  assert.notEqual(specHash(base), hash);
});

test('five adapters generate independent drop pools with target-specific paths and player conditions', () => {
  for (const target of TARGETS) {
    const spec = structuredClone(example);
    spec.target = { ...target.target };
    if (target.target.edition === 'bedrock')
      spec.items = spec.items.filter((i) => ['basic_item', 'food'].includes(i.kind));
    const snapshot = generateWorkspace(spec),
      files = workspaceFiles(snapshot);
    const bedrock = target.target.edition === 'bedrock';
    const prefix = bedrock
      ? 'behavior_pack/loot_tables'
      : `src/main/resources/data/full_workshop/${target.target.minecraft === '1.20.1' ? 'loot_tables' : 'loot_table'}`;
    const block = JSON.parse(files[prefix + '/blocks/glow_block.json']);
    const entity = JSON.parse(files[prefix + '/entities/crystal_guard.json']);
    assert.equal(block.pools[0].entries[0].name, 'full_workshop:crystal');
    assert.ok(
      entity.pools[0].conditions.some(
        (c) => c.condition === (bedrock ? '' : 'minecraft:') + 'killed_by_player',
      ),
    );
    assert.ok(entity.pools[0].conditions.some((c) => c.chance === 0.75));
    assert.equal(entity.pools[0].entries[0].functions[0].count.max, 4);
    if (bedrock) {
      const component = JSON.parse(files['behavior_pack/entities/crystal_guard.json'])[
        'minecraft:entity'
      ].components['minecraft:loot'];
      assert.equal(component.table, 'loot_tables/entities/crystal_guard.json');
      const packed = readZipEntry(packageBedrock(snapshot), 'behavior_pack.mcpack');
      assert.deepEqual(JSON.parse(readZipEntry(packed, component.table)), entity);
      const broken = structuredClone(snapshot);
      broken.files = broken.files.filter((f) => f.path !== 'behavior_pack/' + component.table);
      assert.throws(() => packageBedrock(broken), /缺少资源/);
    }
    delete spec.blocks[0].loot;
    delete spec.entities[0].loot;
    let fallback = workspaceFiles(generateWorkspace(spec));
    assert.equal(
      JSON.parse(fallback[prefix + '/blocks/glow_block.json']).pools[0].entries[0].name,
      'full_workshop:glow_block',
    );
    assert.deepEqual(JSON.parse(fallback[prefix + '/entities/crystal_guard.json']).pools, []);
    spec.blocks[0].loot = [];
    fallback = workspaceFiles(generateWorkspace(spec));
    assert.deepEqual(JSON.parse(fallback[prefix + '/blocks/glow_block.json']).pools, []);
  }
});
