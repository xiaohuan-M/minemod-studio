import { mkdirSync, writeFileSync, readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors.mjs';
/** A local single-writer guard. Unknown hosts/namespaces and malformed locks are never stolen. */
export function acquireDataLock(dataDir) {
  const root = resolve(dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, '.writer-lock.json'),
    token = randomUUID();
  let namespace = 'local';
  try {
    namespace = readFileSync('/proc/self/cgroup', 'utf8');
  } catch {}
  const identity = { pid: process.pid, host: hostname(), namespace, token };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path);
        } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (!lstatSync(path).isFile()) throw Error('invalid');
        const raw = readFileSync(path, 'utf8'),
          owner = JSON.parse(raw);
        if (
          owner.host !== identity.host ||
          owner.namespace !== namespace ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0
        )
          throw Error('unknown');
        try {
          process.kill(owner.pid, 0);
        } catch (e) {
          if (e.code === 'ESRCH' && readFileSync(path, 'utf8') === raw) {
            unlinkSync(path);
            continue;
          }
          throw e;
        }
      } catch {}
      throw new AppError(
        409,
        'DATA_IN_USE',
        '数据目录已有服务使用或存在未知写锁。请关闭其他 MineMod 进程；若进程已退出，备份后检查 .writer-lock.json。',
      );
    }
  }
  throw new AppError(409, 'DATA_IN_USE', '无法取得数据目录写锁。');
}
