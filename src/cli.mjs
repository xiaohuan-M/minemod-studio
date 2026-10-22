import { resolve } from 'node:path';
import { makeServer } from './server.mjs';
import { createOpenAIProvider } from './providers/openai-compatible.mjs';

const rawPort = process.env.MINEMOD_PORT ?? '4310';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('MINEMOD_PORT 必须是 1024–65535 的整数。');
  process.exit(1);
}
const server = makeServer({ dataDir: resolve(process.env.MINEMOD_DATA_DIR ?? '.minemod'), llmProvider: createOpenAIProvider() });
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请修改 MINEMOD_PORT。` : `服务无法启动：${error.code ?? 'UNKNOWN'}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`MineMod Studio · http://127.0.0.1:${port}`);
  console.log('M1 开发版 / 规格编辑与自定义 LLM / 尚无代码生成或编译能力');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
