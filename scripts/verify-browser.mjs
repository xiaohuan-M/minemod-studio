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
  const downloadPromise = page.waitForEvent('download');
  await page.click('#model-screenshot');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'model-preview.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'mobile horizontal overflow',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Browser passed: target selection, Bedrock editing, textured WebGL, UV/display persistence, screenshot, mobile layout.',
  );
} finally {
  await browser?.close();
  await server.workshop.builds.close();
  await new Promise((r) => server.close(r));
  rmSync(dataDir, { recursive: true, force: true });
}
