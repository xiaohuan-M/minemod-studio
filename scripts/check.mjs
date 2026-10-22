import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(mjs|js)$/.test(path) ? [path] : [];
  });
}
let failed = false;
for (const file of ['src', 'web', 'scripts', 'test'].flatMap(files)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
