import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateCodeChanges,
  applyCodeChanges,
  codeContext,
} from '../src/engineering/code-changes.mjs';
import { generateWorkspace, workspaceFiles } from '../src/engineering/generator.mjs';
import { ApiKnowledge } from '../src/creation/knowledge.mjs';
import example from '../examples/project-spec.json' with { type: 'json' };

test('authored code is restricted to the mod namespace and cannot change the build or launcher', () => {
  const prefix = 'src/main/java/studio/minemod/generated/m_' + example.modId + '/',
    pkg = 'studio.minemod.generated.m_' + example.modId;
  const good = {
    summary: '新增玩法辅助类',
    files: [
      {
        path: prefix + 'logic/Bonus.java',
        content:
          'package ' +
          pkg +
          '.logic; public class Bonus { public static int amount() { return 7; } }',
      },
    ],
  };
  assert.equal(validateCodeChanges(good, example.modId).files.length, 1);
  for (const path of [
    'build.gradle',
    'src/main/resources/fabric.mod.json',
    'src/main/java/other/Bonus.java',
    '../evil.java',
    'src/main/resources/META-INF/services/javax.annotation.processing.Processor',
  ])
    assert.throws(() =>
      validateCodeChanges({ ...good, files: [{ ...good.files[0], path }] }, example.modId),
    );
  for (const unsafe of [
    'import java.nio.file.Files;',
    'new ProcessBuilder();',
    'System.getenv("KEY");',
    'ClassLoader.getSystemClassLoader();',
    '\\u0061',
  ])
    assert.throws(() =>
      validateCodeChanges(
        {
          ...good,
          files: [{ path: prefix + 'Bonus.java', content: 'package ' + pkg + '; ' + unsafe }],
        },
        example.modId,
      ),
    );
  assert.throws(
    () => validateCodeChanges({ ...good, files: [...good.files, ...good.files] }, example.modId),
    { code: 'INVALID_CODE_CHANGE' },
  );
  const base = generateWorkspace(example),
    changed = applyCodeChanges(base, example, good);
  assert.notEqual(changed.hash, base.hash);
  assert.equal(changed.specHash, base.specHash);
  assert.equal(workspaceFiles(changed)[good.files[0].path].toString(), good.files[0].content);
  assert.ok(codeContext(changed).some((f) => f.path === good.files[0].path));
  assert.equal(JSON.parse(workspaceFiles(changed)['AI-CHANGES.json']).runtimeTested, false);
});

test('API knowledge uses exact version URLs, sanitizes excerpts, caches facts and makes no unapproved request', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const knowledge = new ApiKnowledge(dir),
    calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return new Response(
      '<main><h1>Item.use</h1><script>untrusted script</script><p>TypedActionResult</p></main>',
    );
  });
  const offline = await knowledge.search('fabric-1.20.1', example);
  assert.equal(calls.length, 0);
  assert.ok(offline[0].url.includes('yarn-1.20.1+build.10'));
  const fetched = await knowledge.search('fabric-1.21.1', example, { allowNetwork: true });
  assert.equal(calls.length, 1);
  assert.equal(fetched[0].fetched, true);
  assert.ok(!fetched[0].text.includes('untrusted script'));
  const cached = await knowledge.search('fabric-1.21.1', example);
  assert.equal(cached[0].cached, true);
  assert.equal(calls.length, 1);
});
