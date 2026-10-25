import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { parseGameTestReceipt } from '../src/engineering/game-tests.mjs';
import { validateCodeChanges } from '../src/engineering/code-changes.mjs';
import { TARGETS } from '../src/core/targets.ts';
import example from '../examples/full-workshop.json' with { type: 'json' };
test('server plans cover target registrations, recipes, attributes and drop ranges; test sources cannot be edited by the model', () => {
  for (const target of TARGETS.filter((t) => t.target.edition === 'java')) {
    const spec = structuredClone(example);
    spec.target = { ...target.target };
    const snapshot = generateWorkspace(spec),
      files = workspaceFiles(snapshot);
    const plan = JSON.parse(files['GAME-TEST-PLAN.json']);
    assert.equal(plan.targetId, target.id);
    assert.equal(plan.cases.length, 4);
    assert.equal(plan.clientVisualTested, false);
    const sourcePath =
      'src/main/java/studio/minemod/testing/m_full_workshop/GeneratedGameChecks.java';
    assert.ok(files[sourcePath].toString().includes('getMaxHealth'));
    assert.throws(() =>
      validateCodeChanges(
        { summary: '替换测试', files: [{ path: sourcePath, content: 'void pass() {}' }] },
        spec.modId,
      ),
    );
    if (target.target.loader !== 'fabric')
      assert.ok(
        gunzipSync(
          files[
            'src/main/resources/data/full_workshop/' +
              (target.target.minecraft === '1.20.1' ? 'structures' : 'structure') +
              '/empty.nbt'
          ],
        ).includes(Buffer.from('minecraft:air')),
      );
    const report = Buffer.from(
      plan.cases.map((c) => JSON.stringify({ name: c.name, passed: true })).join('\n'),
    );
    assert.equal(parseGameTestReceipt(report, plan).passed, 4);
    assert.throws(
      () => parseGameTestReceipt(Buffer.from('{"name":"registrations","passed":true}'), plan),
      { code: 'GAME_TEST_REPORT' },
    );
    assert.throws(() => parseGameTestReceipt(Buffer.from(''), plan), { code: 'GAME_TEST_REPORT' });
    assert.throws(
      () =>
        parseGameTestReceipt(
          Buffer.from(
            plan.cases.map((c) => JSON.stringify({ name: c.name, passed: false })).join('\n'),
          ),
          plan,
        ),
      { code: 'GAME_TEST_REPORT' },
    );
  }
});
