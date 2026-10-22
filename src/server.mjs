import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from './storage/project-store.mjs';
import { mockProvider } from './providers/mock.mjs';
import { capabilities } from './core/capabilities.mjs';
import { AppError } from './core/errors.mjs';

const MAX_BODY = 24 * 1024;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', '请求必须使用 application/json。');
  }
  if (Number(request.headers['content-length']) > MAX_BODY) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', 'JSON 格式不正确。'); }
}

export function makeServer({ dataDir }) {
  const store = new ProjectStore(dataDir);
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const port = request.socket.localPort;
      const origin = `http://127.0.0.1:${port}`;
      // Restrict Host as well as Origin to resist DNS rebinding and cross-site writes.
      if (request.headers.host !== `127.0.0.1:${port}`) throw new AppError(403, 'HOST_DENIED', '请使用本机 127.0.0.1 地址。');
      if (request.headers.origin && request.headers.origin !== origin) throw new AppError(403, 'ORIGIN_DENIED', '不允许跨站请求。');
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && ASSETS.has(pathname)) {
        const [file, type] = ASSETS.get(pathname);
        const content = await readFile(fileURLToPath(new URL(`../web/${file}`, import.meta.url)));
        response.writeHead(200, { 'Content-Type': type });
        response.end(content);
      } else if (request.method === 'GET' && pathname === '/api/health') {
        json(response, 200, { ok: true, version: '0.0.1', stage: 'M0' });
      } else if (request.method === 'GET' && pathname === '/api/capabilities') {
        json(response, 200, capabilities());
      } else if (request.method === 'GET' && pathname === '/api/projects') {
        json(response, 200, { projects: store.list() });
      } else if (request.method === 'POST' && pathname === '/api/projects') {
        json(response, 201, store.create(await body(request)));
      } else if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/plan$/.test(pathname)) {
        const input = await body(request);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
          throw new AppError(400, 'INVALID_INPUT', '演示规划接口只接受空对象。');
        }
        json(response, 200, store.plan(pathname.split('/')[3], mockProvider));
      } else if (request.method === 'GET' && /^\/api\/projects\/[^/]+$/.test(pathname)) {
        json(response, 200, store.get(pathname.split('/')[3]));
      } else {
        throw new AppError(404, 'NOT_FOUND', '接口或文件不存在。');
      }
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) console.error('[minemod] Internal request failure:', error.code ?? error.name);
      if (!response.destroyed && !response.headersSent) {
        json(response, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '本地服务发生错误。' } });
      }
    }
  });
}
