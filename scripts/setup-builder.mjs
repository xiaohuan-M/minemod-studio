import { BuildManager } from '../src/runner/manager.mjs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
// Invoking this dedicated command explicitly authorizes the documented image download.
const dir = mkdtempSync(join(tmpdir(), 'minemod-image-'));
const manager = new BuildManager(dir, null);
const record = await manager.prepare(true, process.env.MINEMOD_BUILD_TARGET);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => manager.close());
let offset = 0;
for (;;) {
  const current = manager.get(record.id);
  process.stdout.write(current.log.slice(offset));
  offset = current.log.length;
  if (['passed', 'failed', 'cancelled', 'timed_out'].includes(current.status)) {
    console.log('\n镜像准备：' + current.status);
    process.exitCode = current.status === 'passed' ? 0 : 1;
    break;
  }
  await setTimeout(1000);
}
rmSync(dir, { recursive: true, force: true });
