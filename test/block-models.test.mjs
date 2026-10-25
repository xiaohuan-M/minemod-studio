import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssetStore } from '../src/storage/asset-store.mjs';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { packageBedrock } from '../src/engineering/adapters/bedrock.mjs';
import { placeholderTexture, pngTexture } from '../src/core/assets.mjs';
import { TARGETS } from '../src/core/targets.ts';
import example from '../examples/full-workshop.json' with { type: 'json' };

test('custom blocks carry model geometry, embedded/explicit textures and provenance through every target', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-block-model-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const assets = new AssetStore(dir);
  const texture = placeholderTexture('#319f75', true),
    model = assets.create({
      name: '雕塑方块',
      kind: 'model',
      source: 'original',
      license: 'CC0',
      data: {
        elements: [
          { from: [5, 0, 5], to: [11, 12, 11], faces: { north: null } },
          { from: [2, 12, 2], to: [14, 16, 14] },
        ],
        texture,
        preview: { body: { scale: [1, 1, 1] } },
      },
    });
  const explicit = assets.create({
    name: '覆盖贴图',
    kind: 'texture',
    source: 'original',
    license: 'CC0',
    data: placeholderTexture('#aa9922', true),
  });
  for (const target of TARGETS) {
    const spec = structuredClone(example);
    spec.target = { ...target.target };
    spec.entities = [];
    spec.blocks[0].modelAsset = model.id;
    if (spec.target.edition === 'bedrock')
      spec.items = spec.items.filter((i) => ['basic_item', 'food'].includes(i.kind));
    for (const override of [false, true]) {
      if (override) spec.blocks[0].textureAsset = explicit.id;
      else delete spec.blocks[0].textureAsset;
      const snapshot = generateWorkspace(spec, [model, explicit]),
        files = workspaceFiles(snapshot),
        prefix =
          spec.target.edition === 'bedrock'
            ? 'resource_pack/'
            : 'src/main/resources/assets/full_workshop/';
      assert.deepEqual(
        files[prefix + 'textures/blocks/full_workshop_glow_block.png'] ??
          files[prefix + 'textures/block/glow_block.png'],
        pngTexture(override ? explicit.data : texture),
      );
      assert.ok(snapshot.assetIds.includes(model.id));
      assert.ok(
        JSON.parse(files['ASSETS.json']).some((a) => a.id === model.id && a.license === 'CC0'),
      );
      if (spec.target.edition === 'bedrock') {
        const block = JSON.parse(files['behavior_pack/blocks/glow_block.json'])['minecraft:block'];
        assert.equal(
          block.components['minecraft:geometry'],
          'geometry.full_workshop.block.glow_block',
        );
        const geometry = JSON.parse(files['resource_pack/models/blocks/glow_block.geo.json'])[
          'minecraft:geometry'
        ][0];
        assert.equal(geometry.bones.length, 2);
        assert.deepEqual(geometry.bones[0].cubes[0].size, [6, 12, 6]);
        assert.equal(Object.hasOwn(geometry.bones[0].cubes[0].uv, 'north'), false);
        assert.ok(packageBedrock(snapshot).length > 0);
        const missing = {
          ...snapshot,
          files: snapshot.files.filter((f) => !f.path.includes('models/blocks/')),
        };
        assert.throws(() => packageBedrock(missing), { code: 'INVALID_PACK' });
      } else {
        const geometry = JSON.parse(files[prefix + 'models/block/glow_block.json']);
        assert.equal(geometry.elements.length, 2);
        assert.equal(geometry.textures.particle, 'full_workshop:block/glow_block');
        assert.equal(Object.hasOwn(geometry.elements[0].faces, 'north'), false);
        assert.equal(Object.hasOwn(geometry, 'preview'), false);
        assert.equal(Object.hasOwn(geometry, 'texture'), false);
        assert.equal(
          JSON.parse(files[prefix + 'models/item/glow_block.json']).parent,
          'full_workshop:block/glow_block',
        );
        if (target.target.loader === 'fabric') {
          assert.ok(JSON.parse(files['src/main/resources/fabric.mod.json']).entrypoints.client);
          assert.match(
            files[
              'src/main/java/studio/minemod/generated/m_full_workshop/GeneratedClient.java'
            ].toString(),
            /BlockRenderLayerMap/,
          );
        } else assert.equal(geometry.render_type, 'minecraft:cutout');
      }
    }
    spec.blocks[0].modelAsset = '00000000-0000-4000-8000-000000000001';
    assert.throws(() => generateWorkspace(spec, []), { code: 'ASSET_MISSING' });
  }
});
