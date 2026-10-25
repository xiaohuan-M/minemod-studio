// A real compatible HTTP fixture, browser renderer and packager; no paid API.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { makeServer } from '../src/server.mjs';
import { createOpenAIProvider } from '../src/providers/openai-compatible.mjs';
import { placeholderTexture } from '../src/core/assets.mjs';
import { readZipEntry } from '../src/core/archive.mjs';
import rig from '../examples/rigged-guardian.json' with { type: 'json' };

let seenCurrent = null;
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw),
    system = payload.messages[0].content,
    input = JSON.parse(payload.messages[1].content);
  let content;
  if (system.includes('pixels')) content = placeholderTexture('#af782e', true);
  else {
    assert.match(system, /hierarchical bones/);
    seenCurrent = input.currentData ?? null;
    content = structuredClone(input.currentData ?? rig);
    if (input.currentData) content.bones.at(-1).rotation[2] = 45;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  );
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const dataDir = mkdtempSync(join(tmpdir(), 'minemod-skeleton-browser-')),
  server = makeServer({
    dataDir,
    llmProvider: createOpenAIProvider({
      MINEMOD_LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
      MINEMOD_LLM_MODEL: 'skeleton-http-fixture',
    }),
  });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MINEMOD_CHROMIUM_PATH
      ? { executablePath: process.env.MINEMOD_CHROMIUM_PATH }
      : {}),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() =>
    document.querySelector('#creation-provider').textContent.includes('skeleton-http-fixture'),
  );
  await page.locator('summary').filter({ hasText: '用我的 LLM 创作与继续修改素材' }).click();
  await page.selectOption('#ai-asset-kind', 'animated_model');
  await page.fill('#ai-asset-prompt', '一位带父子骨骼的方块守卫');
  await page.check('#ai-asset-consent');
  await page.click('#ai-asset-generate');
  await page.locator('#animation-bone option').nth(2).waitFor({ state: 'attached' });
  assert.equal(await page.getAttribute('#animation-canvas', 'data-renderer'), 'three');
  await page.click('#animation-fit');
  const before = await page.locator('#animation-canvas').screenshot();
  await page.locator('#animation-time').fill('1');
  await page.locator('#animation-time').dispatchEvent('input');
  const after = await page.locator('#animation-canvas').screenshot();
  assert.notDeepEqual(before, after, 'Bone animation must visibly change rendered geometry');
  await page.locator('#skeleton-editor > summary').click();
  await page.selectOption('#animation-bone', '2');
  await page.fill('#skeleton-name', '右手臂');
  await page.fill('#skeleton-bind', '15,10,25');
  await page.click('#skeleton-save');
  await page
    .locator('#animation-bone option')
    .filter({ hasText: '右手臂' })
    .waitFor({ state: 'attached' });
  await page.selectOption('#animation-bone', '0');
  await page.selectOption('#skeleton-parent', '2');
  await page.click('#skeleton-save');
  await page.locator('#feedback').filter({ hasText: '循环引用' }).waitFor();
  await page.selectOption('#animation-bone', '2');
  await page.selectOption('#skeleton-cubes', ['1']);
  await page.click('#skeleton-move');
  await page.selectOption('#animation-bone', '1');
  await page.click('#skeleton-delete');
  assert.equal(await page.locator('#animation-bone option').count(), 2);
  await page.fill('#animation-name', '分组守卫');
  await page.click('#animation-save');
  await page.locator('#asset-library').filter({ hasText: '分组守卫' }).waitFor();
  let assets = (await (await fetch(base + '/api/assets')).json()).assets;
  const saved = assets.find((a) => a.name === '分组守卫');
  const model = await (await fetch(base + '/api/assets/' + saved.id)).json();
  assert.deepEqual(model.data.bones[1].elements, [1, 2]);
  assert.equal(model.data.clips[0].tracks[0].bone, 1);
  assert.ok(model.data.texture);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#animation-export'),
  ]);
  const bb = JSON.parse(readFileSync(await download.path()));
  assert.equal(bb.minemod_skeleton, 1);
  assert.equal(bb.outliner.length, 1);
  assert.ok(bb.textures[0].source.startsWith('data:image/png;base64,'));
  const imported = page.waitForResponse((r) => r.url().endsWith('/api/blockbench/import'));
  await page.setInputFiles('#animation-import', {
    name: 'guardian.bbmodel',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bb)),
  });
  assert.equal((await imported).status(), 201);
  await page.locator('#feedback').filter({ hasText: '动画与嵌入贴图已导入' }).waitFor();

  await page.check('#ai-asset-current');
  await page.fill('#ai-asset-prompt', '让手臂抬得更高');
  await page.check('#ai-asset-consent');
  await page.click('#ai-asset-generate');
  await page.waitForFunction(
    () => document.querySelectorAll('#asset-session-history article').length === 2,
  );
  assert.equal(seenCurrent.bones.length, 2);
  assert.equal(seenCurrent.bones[1].name, '右手臂');
  assets = (await (await fetch(base + '/api/assets')).json()).assets;
  const latest = assets.find((a) => a.kind === 'animated_model' && a.id !== saved.id);
  const latestRecord = await (await fetch(base + '/api/assets/' + latest.id)).json();
  assert.equal(latestRecord.data.bones[1].rotation[2], 45);
  await page.fill('#name', '层级角色作品');
  await page.fill('#prompt', '带骨骼的守卫');
  await page.selectOption('#target-select', 'bedrock-1.21.60');
  await page.click('#create-button');
  await page.locator('#project-title').filter({ hasText: '层级角色作品' }).waitFor();
  await page.click('#load-full-example');
  await page.locator('#entity-editor > summary').click();
  await page.fill('#entity-id', 'rig_guard');
  await page.fill('#entity-zh', '骨骼守卫');
  await page.fill('#entity-en', 'Rig Guard');
  await page.selectOption('#entity-model', latest.id);
  await page.click('#entity-save');
  await page.click('#save-spec');
  await page.waitForFunction(() => !document.querySelector('#confirm-spec').disabled);
  await page.click('#confirm-spec');
  await page.click('#generate-workspace');
  await page.waitForFunction(() => !document.querySelector('#approve-workspace').disabled);
  await page.click('#approve-workspace');
  await page.click('#start-build');
  const link = page.locator('#build-downloads a').filter({ hasText: '下载 MCADDON' });
  await link.waitFor();
  const [pack] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const resources = readZipEntry(readFileSync(await pack.path()), 'resource_pack.mcpack');
  const geometry = JSON.parse(readZipEntry(resources, 'models/entity/rig_guard.geo.json'))[
    'minecraft:geometry'
  ][0];
  assert.equal(geometry.bones[1].parent, '身体');
  assert.equal(geometry.bones[1].cubes.length, 2);
  await page.locator('#animation-canvas').screenshot({ path: '/tmp/minemod-skeleton-preview.png' });
  // The same model must be bindable on Java, with protected runtime resources.
  await page.fill('#name', 'Java 骨骼角色');
  await page.fill('#prompt', '自定义角色');
  await page.selectOption('#target-select', 'fabric-1.21.1');
  await page.click('#create-button');
  await page.locator('#project-title').filter({ hasText: 'Java 骨骼角色' }).waitFor();
  await page.click('#load-full-example');
  await page.fill('#entity-id', 'java_rig');
  await page.fill('#entity-zh', 'Java 骨骼角色');
  await page.fill('#entity-en', 'Java Rig');
  await page.selectOption('#entity-model', latest.id);
  await page.fill('#entity-model-prompt', '保留身体，改善挥手动作');
  await page.click('#entity-save');
  await page.click('#save-spec');
  await page.waitForFunction(() => !document.querySelector('#confirm-spec').disabled);
  await page.click('#confirm-spec');
  await page.click('#generate-workspace');
  await page.waitForFunction(() => !document.querySelector('#approve-workspace').disabled);
  const project = (await (await fetch(base + '/api/projects')).json()).projects.find(
    (p) => p.name === 'Java 骨骼角色',
  );
  const snapshots = (
    await (await fetch(base + '/api/projects/' + project.id + '/workspaces')).json()
  ).workspaces;
  assert.ok(snapshots.length);
  assert.equal(project.spec.entities.find((e) => e.id === 'java_rig').modelAsset, latest.id);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Skeleton browser passed: one prompt/compatible HTTP, textured hierarchy, rendered animation, safe regrouping/cycle rejection, complete bbmodel, contextual edits and real MCADDON. Real model quality and Bedrock game rendering not tested.',
  );
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true')
    console.error(
      '::error file=scripts/verify-skeleton-browser.mjs::' +
        String(error.stack ?? error)
          .replaceAll('%', '%25')
          .replaceAll('\r', '%0D')
          .replaceAll('\n', '%0A'),
    );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
