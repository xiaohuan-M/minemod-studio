// Extract and start the actual release outside this checkout, without npm install or Docker.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readZipEntry, sha256, safeArchivePath } from '../src/core/archive.mjs';
import pkg from '../package.json' with { type: 'json' };

const prefix = 'minemod-studio-' + pkg.version;
const bytes = readFileSync(new URL('../dist/' + prefix + '.zip', import.meta.url));
const checksum = readFileSync(
  new URL('../dist/' + prefix + '.zip.sha256', import.meta.url),
  'utf8',
).split(' ')[0];
assert.equal(sha256(bytes), checksum);
const manifest = JSON.parse(readZipEntry(bytes, prefix + '/RELEASE-MANIFEST.json'));
assert.equal(manifest.version, pkg.version);
const temp = mkdtempSync(join(tmpdir(), 'minemod-release-'));
let child, hubChild;
try {
  for (const file of manifest.files) {
    safeArchivePath(file.path);
    assert.ok(
      file.path !== '.env' &&
        !file.path.startsWith('.minemod/') &&
        !file.path.startsWith('node_modules/@playwright/'),
    );
    const data = readZipEntry(bytes, prefix + '/' + file.path, 32 * 1024 * 1024);
    assert.equal(data.length, file.size);
    assert.equal(sha256(data), file.sha256);
    const path = join(temp, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { mode: file.path.endsWith('.sh') ? 0o755 : 0o644 });
  }
  child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import {makeServer} from './src/server.mjs';
    const server=makeServer({dataDir:'.isolated-check'});
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
    process.on('SIGTERM',async()=>{await server.workshop.builds.close();server.close();});
  `,
    ],
    { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Packaged server did not start: ' + stderr)),
      15000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Packaged server exited ' + code + ': ' + stderr));
    });
    child.stdout.once('data', (data) => {
      clearTimeout(timer);
      resolve(Number(data.toString().trim()));
    });
  });
  assert.ok(Number.isInteger(port));
  const base = 'http://127.0.0.1:' + port;
  const get = async (path) => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    return response;
  };
  assert.equal((await (await get('/api/health')).json()).version, pkg.version);
  assert.equal((await (await get('/api/targets')).json()).targets.length, 5);
  assert.ok((await (await get('/api/catalog')).json()).entries.length >= 3);
  for (const path of [
    '/',
    '/app.js',
    '/workshop.js',
    '/model-preview.js',
    '/studio/animation-editor.js',
    '/studio/skeleton.js',
    '/studio/skeleton-editor.js',
    '/studio/provider-settings.js',
    '/studio/loot-editor.js',
    '/studio/creation.js',
    '/studio/asset-sessions.js',
    '/studio/product-versions.js',
    '/vendor/three.js',
    '/vendor/three.core.js',
    '/vendor/OrbitControls.js',
  ])
    await get(path);
  assert.deepEqual((await (await get('/api/settings/providers')).json()).profiles, []);
  const made = await fetch(base + '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '发行包离线检查',
      prompt: '创建附加包',
      targetId: 'bedrock-1.21.60',
    }),
  });
  assert.equal(made.status, 201);
  hubChild = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import {makeHubServer} from './src/hub/server.mjs';
    const server=await makeHubServer({dataDir:'.isolated-hub-check',adminUsername:'release-admin',adminPassword:'isolated release check password'});
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
    process.on('SIGTERM',()=>server.close());
  `,
    ],
    { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let hubErrors = '';
  hubChild.stderr.on('data', (data) => {
    hubErrors += data;
  });
  const hubPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Packaged Hub did not start: ' + hubErrors)),
      15000,
    );
    hubChild.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    hubChild.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Packaged Hub exited ' + code + ': ' + hubErrors));
    });
    hubChild.stdout.once('data', (data) => {
      clearTimeout(timer);
      resolve(Number(data.toString().trim()));
    });
  });
  assert.ok(Number.isInteger(hubPort));
  const hosted = 'http://127.0.0.1:' + hubPort;
  assert.equal((await (await fetch(hosted + '/api/platform')).json()).mode, 'hosted');
  const login = await fetch(hosted + '/api/hub/login', {
    method: 'POST',
    headers: { Origin: hosted, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'release-admin',
      password: 'isolated release check password',
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await fetch(hosted + '/api/projects', { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal((await fetch(hosted + '/hub')).status, 200);
  console.log(
    'Portable release passed: every file hash, dependencies, isolated local and Hub startup, login and per-account workspace, five targets, WebGL, catalog and project creation. No npm install, real API or Docker used.',
  );
} finally {
  for (const process of [child, hubChild])
    if (process && process.exitCode === null) {
      const exited = once(process, 'exit');
      process.kill('SIGTERM');
      await exited;
    }
  rmSync(temp, { recursive: true, force: true });
}
