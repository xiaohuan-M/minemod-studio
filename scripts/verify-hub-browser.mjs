import { chromium } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { makeHubServer } from '../src/hub/server.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'minemod-hub-browser-'));
const server = await makeHubServer({
  dataDir,
  adminUsername: 'admin',
  adminPassword: 'browser secure admin password',
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
  const errors = [],
    admin = await browser.newContext(),
    member = await browser.newContext(),
    device = await browser.newContext();
  const page = await admin.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/hub');
  await page.locator('#login input[name=username]').fill('admin');
  await page.locator('#login input[name=password]').fill('browser secure admin password');
  await page.locator('#login button').click();
  await page.locator('#hosted-account').waitFor({ state: 'visible' });
  await page.click('#hosted-account');
  await page.click('#invite');
  await page.locator('#invite-result').filter({ hasText: '一次性邀请码' }).waitFor();
  const invite = (await page.locator('#invite-result').textContent()).split('：')[1];
  const m = await member.newPage();
  m.on('pageerror', (e) => errors.push(e.message));
  await m.goto(base + '/hub');
  await m.locator('details').first().locator('summary').click();
  await m.locator('#register input[name=username]').fill('browser-maker');
  await m.locator('#register input[name=password]').fill('browser member password');
  await m.locator('#register input[name=invite]').fill(invite);
  await m.locator('#register button').click();
  await m.locator('#name').fill('双设备水晶');
  await m.locator('#prompt').fill('一颗发光的水晶');
  await m.locator('#create-button').click();
  await m.locator('#project-title').filter({ hasText: '双设备水晶' }).waitFor();
  const second = await device.newPage();
  second.on('pageerror', (e) => errors.push(e.message));
  await second.goto(base + '/hub');
  await second.locator('#login input[name=username]').fill('browser-maker');
  await second.locator('#login input[name=password]').fill('browser member password');
  await second.locator('#login button').click();
  await second.locator('#projects').getByText('双设备水晶').click();
  await second.locator('#project-title').filter({ hasText: '双设备水晶' }).waitFor();
  await m.goto(base + '/hub');
  await m.locator('#checkin').click();
  await m.locator('#balance').filter({ hasText: '1010' }).waitFor();
  await m.reload();
  await m.locator('#balance').filter({ hasText: '1010' }).waitFor();
  const assetResponse = await member.request.post(base + '/api/assets', {
    headers: { Origin: base },
    data: {
      name: '浏览器原创立方体',
      kind: 'model',
      data: { elements: [{ from: [0, 0, 0], to: [8, 8, 8] }] },
      source: 'original-browser-fixture',
      license: 'CC0-1.0',
    },
  });
  assert.equal(assetResponse.status(), 201);
  await m.reload();
  await m.locator('#publish input[name=title]').fill('浏览器公开模型');
  await m.locator('#publish textarea[name=description]').fill('浏览器实际验证的原创立方体');
  await m.locator('#publish input[name=license]').fill('CC0-1.0');
  await m.selectOption('#publish-assets', { label: '浏览器原创立方体 · model' });
  await m.locator('#publish input[name=rightsConfirmed]').check();
  await m.locator('#publish button').click();
  await m.locator('#notice').filter({ hasText: '已提交上架审核' }).waitFor();
  await page.reload();
  await page
    .locator('#review-market article')
    .filter({ hasText: '浏览器公开模型' })
    .getByRole('button', { name: '通过上架' })
    .click();
  await page.locator('#market article').filter({ hasText: '浏览器公开模型' }).waitFor();
  await m.reload();
  const card = m.locator('#market article').filter({ hasText: '浏览器公开模型' });
  await card.getByRole('button', { name: '导入我的素材库' }).click();
  await m.locator('#notice').filter({ hasText: '已导入' }).waitFor();
  await card.getByRole('button', { name: '查看模型与来源' }).click();
  await m.locator('#market-canvas[data-renderer=three]').waitFor();
  await m.screenshot({ path: '/tmp/minemod-hub-preview.png' });
  await m.locator('#preview-close').click();
  await m.screenshot({ path: '/tmp/minemod-hub-desktop.png', fullPage: true });
  await m.setViewportSize({ width: 390, height: 844 });
  await m.screenshot({ path: '/tmp/minemod-hub-mobile.png', fullPage: true });
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'Hosted browser passed: invite registration, cross-device project, check-in, publish/review/import, mobile layout; no real model or WeChat call.',
  );
} catch (error) {
  if (process.env.GITHUB_ACTIONS === 'true')
    console.error(
      '::error file=scripts/verify-hub-browser.mjs,title=Hosted browser verification::' +
        String(error.stack ?? error)
          .replaceAll('%', '%25')
          .replaceAll('\r', '%0D')
          .replaceAll('\n', '%0A'),
    );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
