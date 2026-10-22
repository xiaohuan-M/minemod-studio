// Maintainer release tool: ship reviewed tracked source + locked production dependencies.
// Never enumerate user data, configuration, development dependencies or caches.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFiles, sha256, safeArchivePath } from '../src/core/archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
if (pkg.version !== lock.version) throw new Error('Package/lock version mismatch');
const name = 'minemod-studio-' + pkg.version;
const files = {};
function add(path) {
  safeArchivePath(path);
  if (!lstatSync(path).isFile()) throw new Error('Release input is not a regular file: ' + path);
  files[path] = readFileSync(path);
}
const source = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const path of source) {
  if (
    /(^|\/)(\.env(?:\..*)?|\.git|\.minemod|dist|node_modules)(\/|$)/.test(path) &&
    path !== '.env.example'
  )
    throw new Error('Private/generated path is tracked; refusing release: ' + path);
  add(path);
}
const dependencies = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = path + '/' + entry.name;
    if (entry.isDirectory()) walk(child);
    else add(child); // Symlinks fail the regular-file check.
  }
}
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const installed = JSON.parse(readFileSync(path + '/package.json'));
  if (installed.version !== entry.version) throw new Error('Run npm ci: ' + path);
  dependencies.push({
    name: installed.name,
    version: entry.version,
    license: installed.license,
    integrity: entry.integrity,
  });
  walk(path);
}
const manifest = {
  format: 'minemod-portable-release',
  version: pkg.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeModified: !!execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim(),
  node: pkg.engines.node,
  dependencies,
  files: Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })),
};
files['RELEASE-MANIFEST.json'] = JSON.stringify(manifest, null, 2) + '\n';
const archive = zipFiles(
  Object.fromEntries(Object.entries(files).map(([path, bytes]) => [name + '/' + path, bytes])),
);
mkdirSync('dist', { recursive: true });
const output = resolve('dist', name + '.zip');
writeFileSync(output, archive);
writeFileSync(output + '.sha256', sha256(archive) + '  ' + name + '.zip\n');
console.log(
  JSON.stringify(
    {
      path: output,
      bytes: archive.length,
      sha256: sha256(archive),
      files: Object.keys(files).length,
      commit: manifest.commit,
      workingTreeModified: manifest.workingTreeModified,
    },
    null,
    2,
  ),
);
