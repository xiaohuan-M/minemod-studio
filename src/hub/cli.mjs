import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeHubServer } from './server.mjs';

const port = Number(process.env.MINEMOD_HUB_PORT ?? '4320'),
  host = process.env.MINEMOD_HUB_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('MINEMOD_HUB_PORT 必须为 1024–65535。');
if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) throw new Error('托管监听地址无效。');
if (!['127.0.0.1', '::1'].includes(host) && !process.env.MINEMOD_HUB_PUBLIC_ORIGIN)
  throw new Error('远程监听需要设置 HTTPS MINEMOD_HUB_PUBLIC_ORIGIN，并在前方配置 TLS 反向代理。');
const configured = (value) => {
  if (value === undefined) return false;
  if (!['true', 'false'].includes(value)) throw new Error('注册开关必须为 true / false。');
  return value === 'true';
};
const routes = process.env.MINEMOD_HUB_ROUTES_FILE
  ? JSON.parse(readFileSync(resolve(process.env.MINEMOD_HUB_ROUTES_FILE), 'utf8'))
  : [];
const server = await makeHubServer({
  dataDir: resolve(process.env.MINEMOD_HUB_DATA_DIR ?? '.minemod-hub'),
  publicOrigin: process.env.MINEMOD_HUB_PUBLIC_ORIGIN ?? null,
  adminUsername: process.env.MINEMOD_HUB_ADMIN_USERNAME,
  adminPassword: process.env.MINEMOD_HUB_ADMIN_PASSWORD,
  allowRegistration: configured(process.env.MINEMOD_HUB_ALLOW_REGISTRATION),
  providerRoutes: routes,
  providerHosts: (process.env.MINEMOD_HUB_PROVIDER_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxWorkspaces: Number(process.env.MINEMOD_HUB_MAX_WORKSPACES ?? 4),
  wechat: process.env.MINEMOD_WECHAT_APP_ID
    ? { appId: process.env.MINEMOD_WECHAT_APP_ID, appSecret: process.env.MINEMOD_WECHAT_APP_SECRET }
    : null,
});
server.on('error', () => {
  console.error('托管服务启动失败，请检查端口、监听地址与数据目录。');
  server.close(() => {
    process.exitCode = 1;
  });
});
server.listen(port, host, () =>
  console.log(
    'MineMod Studio 共享工作室 · ' +
      (process.env.MINEMOD_HUB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`),
  ),
);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
