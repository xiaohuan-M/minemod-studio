// Browser integration: uses an isolated data directory and never calls a real provider.
import { chromium } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.mjs';
const parent = resolve('.minemod');
mkdirSync(parent, { recursive: true });
const dataDir = mkdtempSync(join(parent, 'browser-'));
const server = makeServer({ dataDir });
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
  await page
    .locator('#target-select option[value="bedrock-1.21.60"]')
    .waitFor({ state: 'attached' });
  await page.fill('#name', '浏览器附加包');
  await page.fill('#prompt', '食物和发光方块');
  await page.selectOption('#target-select', 'bedrock-1.21.60');
  await page.click('#create-button');
  await page.locator('#project-title').filter({ hasText: '浏览器附加包' }).waitFor();
  await page.locator('#proposal-panel summary').click();
  await page.click('#proposal-button');
  await page.waitForFunction(() => document.querySelectorAll('#proposals-list .card').length === 3);
  await page.locator('#proposals-list button').first().click();
  await page.click('#spec-button');
  await page.waitForFunction(() => document.querySelectorAll('.conversation-entry').length === 1);
  await page.click('#load-full-example');
  await page.click('#save-spec');
  await page.waitForFunction(() => !document.querySelector('#confirm-spec').disabled);
  await page.click('#confirm-spec');
  // Verify the actual WebGL renderer and persisted UV/display settings.
  assert.equal(await page.getAttribute('#model-canvas', 'data-renderer'), 'three');
  await page.locator('summary').filter({ hasText: '旋转、UV 与显示姿态' }).click();
  await page.selectOption('#uv-rotation', '90');
  await page.fill('#uv-coordinates', '0,0,8,16');
  await page.click('#uv-update');
  await page.selectOption('#model-view', 'hand');
  await page.fill('#display-scale', '0.5,0.5,0.5');
  await page.click('#display-update');
  await page.click('#pixel-fill');
  await page.click('#model-texture-pixels');
  await page.fill('#model-name', 'UV与姿态');
  await page.click('#model-save');
  await page.waitForFunction(() =>
    document.querySelector('#asset-library').textContent.includes('UV与姿态'),
  );
  const assets = await page.evaluate(() => fetch('/api/assets').then((r) => r.json()));
  const asset = assets.assets.find((a) => a.name === 'UV与姿态');
  const model = await page.evaluate(
    (id) => fetch('/api/assets/' + id).then((r) => r.json()),
    asset.id,
  );
  assert.equal(model.data.elements[0].faces.north.rotation, 90);
  assert.deepEqual(model.data.display.thirdperson_righthand.scale, [0.5, 0.5, 0.5]);
  await page.selectOption('#uv-rotation', '0');
  await page.click('#uv-update');
  await page.locator('#animation-studio summary').click();
  await page.click('#animation-create');
  await page.click('#animation-save-key');
  await page.locator('#animation-time').fill('1');
  await page.locator('#animation-time').dispatchEvent('input');
  await page.fill('#animation-rotation', '0,90,0');
  await page.click('#animation-save-key');
  await page.fill('#animation-name', '浏览器关键帧动画');
  await page.click('#animation-save');
  await page.waitForFunction(() =>
    document.querySelector('#asset-library').textContent.includes('浏览器关键帧动画'),
  );
  await page.click('#animation-play');
  await page.waitForTimeout(150);
  await page.click('#animation-play');
  await page.locator('#entity-editor summary').click();
  await page.fill('#entity-id', 'animated_actor');
  await page.fill('#entity-zh', '动画角色');
  await page.fill('#entity-en', 'Animated Actor');
  await page.selectOption('#entity-model', { label: '浏览器关键帧动画' });
  await page.fill('#entity-clip', 'walk');
  await page.click('#entity-save');
  await page.click('#save-spec');
  await page.waitForFunction(() => !document.querySelector('#confirm-spec').disabled);
  await page.click('#confirm-spec');
  await page.waitForFunction(() => !document.querySelector('#generate-workspace').disabled);
  await page.click('#generate-workspace');
  await page.waitForFunction(() => !document.querySelector('#approve-workspace').disabled);
  await page.click('#approve-workspace');
  await page.waitForFunction(() => !document.querySelector('#start-build').disabled);
  await page.click('#start-build');
  await page.locator('#build-downloads a').filter({ hasText: '下载 MCADDON' }).waitFor();
  const artifactDownload = page.waitForEvent('download');
  await page.locator('#build-downloads a').filter({ hasText: '下载 MCADDON' }).click();
  assert.match((await artifactDownload).suggestedFilename(), /\.mcaddon$/);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#model-screenshot');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'model-preview.png');
  const projectId = await page.evaluate(
    () => document.querySelector('#export-spec').getAttribute('href').split('/')[3],
  );
  const backup = await page.evaluate(
    (id) => fetch('/api/projects/' + id + '/backup').then((r) => r.json()),
    projectId,
  );
  const importResponse = page.waitForResponse((r) =>
    r.url().endsWith('/api/projects/import-backup'),
  );
  await page.setInputFiles('#backup-import', {
    name: 'project.minemod.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const imported = await importResponse;
  assert.equal(imported.status(), 201, await imported.text());
  await page.waitForFunction(
    (old) => document.querySelector('#export-spec').getAttribute('href').split('/')[3] !== old,
    projectId,
  );
  assert.equal(await page.locator('.conversation-entry').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'mobile horizontal overflow',
  );
  assert.deepEqual(errors, []);
  // GPU-disabled machines must keep editing/export usable instead of throwing in animation setup.
  const fallback = await browser.newPage();
  const fallbackErrors = [];
  fallback.on('pageerror', (e) => fallbackErrors.push(e.message));
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await fallback.goto('http://127.0.0.1:' + server.address().port);
  await fallback.locator('#projects button').first().click();
  assert.equal(await fallback.getAttribute('#model-canvas', 'data-renderer'), 'unavailable');
  await fallback.locator('#animation-studio summary').click();
  await fallback.click('#animation-create');
  await fallback.click('#animation-save-key');
  await fallback.fill('#animation-name', '无 GPU 编辑');
  await fallback.click('#animation-save');
  await fallback.waitForFunction(() =>
    document.querySelector('#asset-library').textContent.includes('无 GPU 编辑'),
  );
  assert.deepEqual(fallbackErrors, []);
  await fallback.close();
  console.log(
    'Browser passed: proposals/conversation, targets, WebGL/UV, animated entity editing, MCADDON export, portable backup, mobile layout and editing without WebGL.',
  );
} finally {
  await browser?.close();
  await server.workshop.builds.close();
  await new Promise((r) => server.close(r));
  rmSync(dataDir, { recursive: true, force: true });
}
