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
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
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
  assert.equal(caps.features.gradleBuild, true);
  assert.equal(caps.provider.externalRequests, false);
});

test('rejects cross-site writes, malformed JSON, large bodies and unknown files', async (t) => {
  const base = await fixture(t);
  assert.equal(
    (await post(base, '/api/projects', {}, { Origin: 'https://example.com' })).status,
    403,
  );
  assert.equal(
    (await post(base, '/api/projects', {}, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  );
  assert.equal((await post(base, '/api/projects', { prompt: 'a'.repeat(30_000) })).status, 413);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/src/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/invalid`)).status, 400);
});

test('rejects DNS rebinding Host header', async (t) => {
  const base = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/health`, { headers: { Host: 'attacker.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
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
  assert.match(await response.text(), /多目标本地创作工坊/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
});

test('spec workflow validates, persists, confirms, exports and rejects stale edits', async (t) => {
  const base = await fixture(t);
  let project = await (
    await post(base, '/api/projects', { name: '规格工坊', prompt: '普通物品与合成' })
  ).json();
  const route = '/api/projects/' + project.id;
  assert.equal((await post(base, route + '/spec/confirm', { revision: 0 })).status, 409);
  project = await (
    await post(base, route + '/spec/generate', { provider: 'mock', revision: 0 })
  ).json();
  assert.equal(project.status, 'awaiting_review');
  assert.equal(project.specSource.demo, true);
  assert.equal(project.spec.schemaVersion, 1);
  const revision = project.revision;
  project = await (await post(base, route + '/spec/confirm', { revision })).json();
  assert.equal(project.confirmedSpecHash, project.specHash);
  assert.equal(project.status, 'spec_confirmed');
  assert.equal(
    (await post(base, route + '/spec/generate', { provider: 'mock', revision })).status,
    409,
  );
  const exported = await fetch(base + route + '/spec/export');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(await exported.json(), project.spec);
  const put = (spec) =>
    fetch(base + route + '/spec', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, revision: project.revision }),
    });
  assert.equal((await put({ ...project.spec, command: 'not allowed' })).status, 422);
  assert.equal((await (await fetch(base + route)).json()).revision, project.revision);
  project.spec.displayName = '修改后的工坊';
  const updated = await (await put(project.spec)).json();
  assert.equal(updated.confirmedSpecHash, null);
  assert.equal(updated.status, 'awaiting_review');
  assert.equal(updated.specSource.provider, 'manual');
  assert.notEqual(updated.specHash, project.specHash);
  assert.equal(
    (await (await fetch(base + '/api/schema/mod-spec')).json()).title,
    'MineMod ModSpec v1',
  );
});

test('history API separates metadata and snapshots and restores with revision checks', async (t) => {
  const base = await fixture(t);
  let project = await (
    await post(base, '/api/projects', { name: '历史项目', prompt: '普通物品' })
  ).json();
  const root = '/api/projects/' + project.id;
  project = await (
    await post(base, root + '/spec/generate', { provider: 'mock', revision: 0 })
  ).json();
  const original = structuredClone(project);
  project = await (
    await post(base, root + '/spec/generate', { provider: 'mock', revision: project.revision })
  ).json();
  assert.equal(project.historyCount, 1);
  assert.equal('specHistory' in project, false);
  const { history, limit } = await (await fetch(base + root + '/spec/history')).json();
  assert.equal(limit, 20);
  assert.equal(history[0].revision, original.revision);
  assert.equal('spec' in history[0], false);
  const snapshot = await (await fetch(base + root + '/spec/history/' + original.revision)).json();
  assert.deepEqual(snapshot.spec, original.spec);
  assert.equal(
    (await post(base, root + '/spec/restore', { fromRevision: original.revision, revision: 0 }))
      .status,
    409,
  );
  const restore = await post(base, root + '/spec/restore', {
    fromRevision: original.revision,
    revision: project.revision,
  });
  assert.equal(restore.status, 200);
  const restored = await restore.json();
  assert.equal(restored.historyCount, 2);
  assert.equal(restored.confirmedSpecHash, null);
  assert.equal((await fetch(base + root + '/spec/history/99999')).status, 404);
});
