import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { makeServer } from '../src/server.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'minemod-http-'));
  const server = makeServer({ dataDir: dir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, path, value, headers = {}) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

test('HTTP workflow: create, list, plan, reopen; no fictional JAR', async (t) => {
  const base = await fixture(t);
  const created = await post(base, '/api/projects', { name: '工坊', prompt: '一把发光的锤子' });
  assert.equal(created.status, 201);
  const project = await created.json();
  const plan = await post(base, `/api/projects/${project.id}/plan`, {});
  assert.equal(plan.status, 200);
  const reopened = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(reopened.plan.demo, true);
  assert.deepEqual(reopened.artifacts, []);
  const list = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(list.projects[0].id, project.id);
  const caps = await (await fetch(`${base}/api/capabilities`)).json();
  assert.equal(caps.features.gradleBuild, false);
  assert.equal(caps.provider.externalRequests, false);
});

test('rejects cross-site writes, malformed JSON, large bodies and unknown files', async (t) => {
  const base = await fixture(t);
  assert.equal((await post(base, '/api/projects', {}, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post(base, '/api/projects', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post(base, '/api/projects', { prompt: 'a'.repeat(30_000) })).status, 413);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/src/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/invalid`)).status, 400);
});

test('rejects DNS rebinding Host header', async (t) => {
  const base = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/health`, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('serves a static shell with a restrictive content security policy', async (t) => {
  const base = await fixture(t);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.match(await response.text(), /开发基础版/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
});
