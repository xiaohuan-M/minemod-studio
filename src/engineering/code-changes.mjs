import { AppError } from '../core/errors.mjs';
import { safeArchivePath } from '../core/archive.mjs';
import { snapshotFromFiles } from './snapshot.mjs';

const fail = (message) => {
  throw new AppError(422, 'INVALID_CODE_CHANGE', message);
};
/** File/data policy, not a proof of runtime behavior. Compilation stays inside the fixed runner. */
export function validateCodeChanges(input, modId) {
  if (
    !input ||
    typeof input.summary !== 'string' ||
    !input.summary.trim() ||
    input.summary.length > 1200 ||
    !Array.isArray(input.files) ||
    input.files.length > 24
  )
    fail('代码修改需要说明及最多 24 个完整文件。');
  const paths = new Set();
  let total = 0;
  const javaRoot = 'src/main/java/studio/minemod/generated/m_' + modId + '/',
    packageName = 'studio.minemod.generated.m_' + modId;
  const files = input.files.map((file) => {
    if (
      !file ||
      Object.keys(file).some((k) => !['path', 'content'].includes(k)) ||
      typeof file.path !== 'string' ||
      typeof file.content !== 'string'
    )
      fail('代码文件字段无效。');
    safeArchivePath(file.path);
    if (paths.has(file.path)) fail('修改文件路径重复。');
    paths.add(file.path);
    total += Buffer.byteLength(file.content);
    if (total > 128 * 1024 || file.content.includes('\0'))
      fail('代码修改超过 128 KiB 或包含非法字符。');
    const java =
      file.path.startsWith(javaRoot) &&
      /^[A-Za-z0-9_/]+\.java$/.test(file.path.slice(javaRoot.length));
    const json =
      ['src/main/resources/data/' + modId + '/', 'src/main/resources/assets/' + modId + '/'].some(
        (root) => file.path.startsWith(root),
      ) && file.path.endsWith('.json');
    if (!java && !json)
      fail(
        '只允许修改本模组命名空间的 Java 与 JSON 资源，不能修改构建脚本、依赖、入口元数据或运行器。',
      );
    if (java) {
      const declaration = file.content.match(/\bpackage\s+([a-zA-Z0-9_.]+)\s*;/);
      const relativeDirectory = file.path.slice(javaRoot.length, file.path.lastIndexOf('/'));
      const expected =
        packageName + (relativeDirectory ? '.' + relativeDirectory.replaceAll('/', '.') : '');
      if (!declaration || declaration[1] !== expected)
        fail('Java package 必须与受控文件路径一致。');
      if (
        /\\u[0-9a-f]{4}|java\s*\.\s*(?:io|nio|net|lang\s*\.\s*(?:reflect|invoke))\b|\b(?:ProcessBuilder|Runtime|ClassLoader|SecurityManager)\b|\bSystem\s*\.\s*(?:exit|load|loadLibrary|getenv|getProperties|setProperties)|javax\s*\.\s*(?:script|tools)|\b(?:sun|jdk)\s*\./i.test(
          file.content,
        )
      )
        fail('生成代码不能包含进程、网络、文件、反射或动态执行接口；此流程只实现游戏玩法。');
    } else {
      try {
        JSON.parse(file.content);
      } catch {
        fail('资源文件必须是有效 JSON。');
      }
    }
    return { path: file.path, content: file.content };
  });
  return { summary: input.summary.trim(), files };
}
export function applyCodeChanges(snapshot, spec, input) {
  const changes = validateCodeChanges(input, spec.modId);
  if (!changes.files.length) return snapshot;
  const files = Object.fromEntries(
    snapshot.files.map((f) => [f.path, Buffer.from(f.content, 'base64')]),
  );
  for (const file of changes.files) files[file.path] = Buffer.from(file.content);
  files['AI-CHANGES.json'] = Buffer.from(
    JSON.stringify(
      { summary: changes.summary, files: changes.files.map((f) => f.path), runtimeTested: false },
      null,
      2,
    ),
  );
  return snapshotFromFiles({
    spec,
    files,
    targetId: snapshot.targetId,
    template: snapshot.template,
    assetIds: snapshot.assetIds,
  });
}
export function codeContext(snapshot) {
  let size = 0;
  return snapshot.files
    .filter((f) => f.path.endsWith('.java'))
    .map((f) => ({ path: f.path, content: Buffer.from(f.content, 'base64').toString('utf8') }))
    .filter((f) => (size += Buffer.byteLength(f.content)) <= 160 * 1024)
    .slice(0, 24);
}
