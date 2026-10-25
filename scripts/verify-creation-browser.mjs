// Real browser + compatible HTTP fixture + real local packager. No external model is called.
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
import example from '../examples/project-spec.json' with { type: 'json' };

const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks)),
    system = payload.messages[0].content;
  let content;
  if (system.includes('structured Minecraft assets')) {
    const raw = payload.messages[1].content,
      input = JSON.parse(Array.isArray(raw) ? raw[0].text : raw);
    content = system.includes('pixels')
      ? placeholderTexture()
      : structuredClone(input.currentData ?? { elements: [{ from: [4, 0, 4], to: [12, 16, 12] }] });
    if (input.currentData && !system.includes('pixels')) content.elements[0].to[1] = 20;
  } else {
    const input = JSON.parse(payload.messages[1].content);
    content = structuredClone(input.currentSpec ?? example);
    content.target = input.target;
    content.displayName = input.name;
    if (input.currentSpec && input.instruction) content.displayName = '继续完善的作品';
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
  );
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const dir = mkdtempSync(join(tmpdir(), 'minemod-creation-browser-'));
const server = makeServer({
  dataDir: dir,
  llmProvider: createOpenAIProvider({
    MINEMOD_LLM_BASE_URL: 'http://127.0.0.1:' + upstream.address().port + '/v1',
    MINEMOD_LLM_MODEL: 'local-http-fixture',
  }),
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
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
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() =>
    document.querySelector('#creation-provider').textContent.includes('local-http-fixture'),
  );
  await page.fill('#prompt', '制作一颗可合成的晶体');
  await page.selectOption('#target-select', 'bedrock-1.21.60');
  await page.check('#creation-approved');
  await page.click('#create-automatically');
  await page.waitForFunction(() =>
    document.querySelector('#creation-status').textContent.includes('构建完成'),
  );
  assert.ok((await page.locator('#creation-events li').count()) > 4);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#creation-downloads a').filter({ hasText: '下载作品' }).click(),
  ]);
  const artifact = readFileSync(await download.path());
  readZipEntry(readZipEntry(artifact, 'behavior_pack.mcpack'), 'manifest.json');
  await page.locator('#product-versions > summary').click();
  await page
    .locator('#product-versions-list button')
    .filter({ hasText: '恢复完整作品' })
    .first()
    .waitFor();
  await page.fill('#revision-instruction', '让晶体变得更漂亮');
  await page.check('#creation-approved');
  await page.click('#creation-continue');
  await page.waitForFunction(() =>
    document.querySelector('#spec-editor').value.includes('继续完善的作品'),
  );
  await page.waitForFunction(() =>
    document.querySelector('#creation-status').textContent.includes('构建完成'),
  );
  await page.waitForFunction(
    () => document.querySelectorAll('#product-versions-list .card').length >= 2,
  );
  const cards = page.locator('#product-versions-list .card');
  await cards
    .filter({ hasText: '自动创作完成 · 制作一颗可合成的晶体' })
    .getByRole('button', { name: '恢复完整作品' })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('#spec-editor').value.includes('继续完善的作品'),
  );
  await page.locator('summary').filter({ hasText: '用我的 LLM 创作与继续修改素材' }).click();
  await page.selectOption('#ai-asset-kind', 'model');
  await page.fill('#ai-asset-prompt', '做一根法杖');
  await page.check('#ai-asset-consent');
  await page.click('#ai-asset-generate');
  await page.waitForFunction(
    () => document.querySelectorAll('#asset-session-history article').length === 1,
  );
  await page.fill('#ai-asset-prompt', '把顶部加长');
  await page.check('#ai-asset-consent');
  await page.click('#ai-asset-generate');
  await page.waitForFunction(
    () => document.querySelectorAll('#asset-session-history article').length === 2,
  );
  assert.equal(await page.inputValue('#cube-to'), '12,20,12');
  await page.locator('#asset-session-history button').first().click();
  await page.waitForFunction(() => document.querySelector('#cube-to').value === '12,16,12');
  await page.selectOption('#model-view', 'body');
  await page.locator('summary').filter({ hasText: '旋转、UV 与显示姿态' }).click();
  await page.fill('#display-translation', '0,1,3');
  await page.click('#display-update');
  await page.click('#model-save');
  await page.locator('#model-canvas').screenshot({ path: '/tmp/minemod-body-preview.png' });
  await page.reload();
  await page.locator('#projects button').first().click();
  await page.waitForFunction(() =>
    document.querySelector('#creation-status').textContent.includes('构建完成'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Browser flow passed: actual compatible HTTP, automatic MCADDON, complete round restore, contextual model edits with immutable history, body preview, reload and narrow layout. No real model or game used.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
