import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { entityMesh } from '../src/engineering/entity-mesh.mjs';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { validateCodeChanges, codeContext } from '../src/engineering/code-changes.mjs';
import { pngTexture, placeholderTexture } from '../src/core/assets.mjs';
import { TARGETS } from '../src/core/targets.ts';
import fixture from '../examples/full-workshop.json' with { type: 'json' };
import rig from '../examples/rigged-guardian.json' with { type: 'json' };

test('compiled entity quads preserve hidden faces, UV orientation, outward normals, pivots and legacy bind rotations', () => {
  const model = {
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: { east: { uv: [0, 0, 8, 16], rotation: 90 }, west: null },
      },
    ],
  };
  const mesh = entityMesh(model, 'model');
  assert.equal(mesh.order, 'XYZ');
  assert.equal(mesh.bones[0].vertices.length, 20);
  assert.deepEqual(mesh.bones[0].position, [0, 0.5, 0]);
  const vertices = mesh.bones[0].vertices;
  assert.deepEqual(vertices[0], [0.5, 0.5, 0.5, 0, 1, 1, 0, 0]);
  for (let i = 0; i < vertices.length; i += 4) {
    const [a, b, c] = vertices.slice(i, i + 3),
      u = b.slice(0, 3).map((v, i) => v - a[i]),
      v = c.slice(0, 3).map((v, i) => v - a[i]),
      cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(cross.reduce((s, n, i) => s + n * a[i + 5], 0) > 0);
  }
  const rotated = entityMesh(
    {
      elements: [
        {
          ...model.elements[0],
          rotation: { origin: [4, 8, 4], axis: 'z', angle: 45, rescale: true },
        },
      ],
    },
    'model',
  );
  assert.deepEqual(rotated.bones[0].rotation, [0, 0, 45]);
  assert.deepEqual(rotated.bones[0].position, [-0.25, 0.5, -0.25]);
  assert.ok(
    rotated.radius >=
      Math.max(...rotated.bones[0].vertices.map((v) => Math.hypot(...v.slice(0, 3)))),
  );
  const hierarchical = entityMesh(rig, 'animated_model', 'wave');
  assert.equal(hierarchical.order, 'ZYX');
  assert.equal(hierarchical.bones[2].parent, 0);
  assert.ok(hierarchical.bones[0].children.includes(2));
  assert.equal(hierarchical.clip.tracks[0].bone, 2);
  assert.throws(
    () => entityMesh(rig, 'animated_model', 'missing'),
    (e) => e.code === 'ANIMATION_CLIP',
  );
});

test('all Java targets package original protected renderers, hierarchical mesh and texture overrides while preserving server archetypes', () => {
  const model = {
    id: randomUUID(),
    kind: 'animated_model',
    name: '层级模型',
    source: 'original',
    license: 'CC0',
    data: { ...rig, texture: placeholderTexture('#2288aa', true) },
  };
  const override = {
    id: randomUUID(),
    kind: 'texture',
    name: '覆盖贴图',
    source: 'original',
    license: 'CC0',
    data: placeholderTexture('#aa2288', true),
  };
  for (const target of TARGETS.filter((t) => t.target.edition === 'java')) {
    const spec = structuredClone(fixture);
    spec.target = { ...target.target };
    spec.entities[0].modelAsset = model.id;
    spec.entities[0].animationClip = 'wave';
    for (const explicit of [false, true]) {
      if (explicit) spec.entities[0].textureAsset = override.id;
      const source = generateWorkspace(spec, [model, override]),
        files = workspaceFiles(source),
        ns = spec.modId;
      assert.deepEqual(
        files['src/main/resources/assets/' + ns + '/textures/entity/crystal_guard.png'],
        pngTexture(explicit ? override.data : model.data.texture),
      );
      const meshPath =
          'src/main/resources/assets/minemod_runtime_m_' + ns + '/entity/crystal_guard.json',
        javaPath = 'src/main/java/studio/minemod/runtime/m_' + ns + '/StudioEntityRenderer.java';
      assert.equal(JSON.parse(files[meshPath]).bones.length, 3);
      const renderer = files[javaPath].toString();
      assert.ok(renderer.includes('rotationZYX'));
      assert.ok(renderer.includes('getResourceAsStream'));
      assert.ok(!renderer.includes('TextureId'));
      assert.ok(!codeContext(source).some((f) => f.path === javaPath));
      for (const path of [javaPath, meshPath])
        assert.throws(
          () =>
            validateCodeChanges(
              { summary: 'attempt', files: [{ path, content: files[path].toString() }] },
              ns,
            ),
          (e) => e.code === 'INVALID_CODE_CHANGE',
        );
      const client =
        files[
          'src/main/java/studio/minemod/generated/m_' + ns + '/GeneratedClient.java'
        ].toString();
      assert.ok(client.includes('StudioEntityRenderer<>'));
      assert.ok(client.includes('CowEntityRenderer') || client.includes('CowRenderer'));
      const server =
        files['src/main/java/studio/minemod/generated/m_' + ns + '/GeneratedMod.java'].toString();
      assert.ok(!server.includes('StudioEntityRenderer'));
      assert.ok(server.includes('movement') || server.includes('MOVEMENT_SPEED'));
    }
  }
});
