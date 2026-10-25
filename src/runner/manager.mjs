import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { JsonDirectory } from '../storage/json-directory.mjs';
import { TEMPLATE, workspaceFiles, builderTemplate } from '../engineering/generator.mjs';
import { sha256, readZipEntry } from '../core/archive.mjs';
import { packageBedrock } from '../engineering/adapters/bedrock.mjs';
import { AppError } from '../core/errors.mjs';
import { supportsGameTests, parseGameTestReceipt } from '../engineering/game-tests.mjs';
const execute = promisify(execFile);
const TERMINAL = new Set(['passed', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const script = fileURLToPath(new URL('../../scripts/container-build.sh', import.meta.url));
const endpoint =
  process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
const baseArgs = ['--host=' + endpoint];
function environment() {
  const env = { ...process.env };
  for (const key of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete env[key];
  return env;
}
function sanitize(text) {
  return String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/^Picked up JAVA_TOOL_OPTIONS:.*$/gm, '[JVM trust and proxy configured]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[redacted]@')
    .slice(-256 * 1024);
}

async function executeDocker(args, options = {}) {
  return execute('docker', [...baseArgs, ...args], {
    env: environment(),
    timeout: 15000,
    maxBuffer: 128 * 1024,
    ...options,
  });
}
export async function builderStatus(targetId) {
  const template = builderTemplate(targetId);
  let dockerVersion = null,
    imageReady = false;
  try {
    dockerVersion = (
      await executeDocker(['version', '--format', '{{.Server.Version}}'])
    ).stdout.trim();
  } catch {
    return {
      available: false,
      imageReady: false,
      image: template.builderImage,
      reason: 'Docker 未运行或本机守护进程不可访问。请安装并启动 Docker；源码导出仍可使用。',
    };
  }
  try {
    await executeDocker(['image', 'inspect', template.builderImage, '--format', '{{.Id}}']);
    imageReady = true;
  } catch {}
  return {
    available: true,
    dockerVersion,
    imageReady,
    image: template.builderImage,
    limits: { cpus: 2, memoryGiB: 4, timeoutSeconds: 600 },
    reason: imageReady ? null : '请先准备固定版本的构建镜像。',
  };
}

export class BuildManager {
  constructor(dataDir, workspaces) {
    this.root = resolve(dataDir, 'builds');
    if (/[,\r\n]/.test(this.root))
      throw new Error('Build data path cannot contain commas or newlines.');
    this.records = new JsonDirectory(join(this.root, 'records'));
    this.workspaces = workspaces;
    this.active = new Map();
    for (const id of this.records.ids()) {
      const record = this.records.read(id);
      if (!TERMINAL.has(record.status)) {
        record.status = 'interrupted';
        record.finishedAt = new Date().toISOString();
        record.log = sanitize(
          (record.log ?? '') + '\n服务重启，之前的任务已中断；请重新启动构建。',
        );
        this.records.write(id, record);
        if (['build', 'game-test'].includes(record.type)) void this.removeContainer(id);
      }
    }
  }
  async docker(args, options = {}) {
    return executeDocker(args, options);
  }
  async status(targetId) {
    return builderStatus(targetId);
  }
  get(id) {
    const record = this.records.read(id);
    if (record.id !== id) throw new AppError(500, 'BUILD_CORRUPT', '构建记录损坏。');
    return record;
  }
  list(projectId) {
    return this.records
      .ids()
      .map((id) => this.get(id))
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ log, ...record }) => ({ ...record, logBytes: Buffer.byteLength(log ?? '') }));
  }
  async start(projectId, snapshotHash, { allowNetwork = false, approval } = {}) {
    if (this.active.size)
      throw new AppError(409, 'BUILD_ACTIVE', '已有构建任务运行，请等待或取消后再开始。');
    const snapshot = this.workspaces.get(projectId, snapshotHash);
    if (snapshot.imported)
      throw new AppError(
        409,
        'IMPORTED_WORKSPACE',
        '导入工程可查看和下载；请从规格重新生成并审查后再构建。',
      );
    if (approval !== snapshotHash)
      throw new AppError(400, 'BUILD_APPROVAL_REQUIRED', '请审查此工程快照，并明确批准构建。');
    if (typeof allowNetwork !== 'boolean')
      throw new AppError(400, 'INVALID_INPUT', '联网选项必须为布尔值。');
    return this.launch({ type: 'build', projectId, snapshotHash, allowNetwork, snapshot });
  }
  async prepare(approved, targetId) {
    if (approved !== true)
      throw new AppError(400, 'BUILD_APPROVAL_REQUIRED', '下载构建镜像需要明确确认联网。');
    if (this.active.size) throw new AppError(409, 'BUILD_ACTIVE', '已有任务运行。');
    return this.launch({
      type: 'prepare',
      selectedTemplate: builderTemplate(targetId),
      targetId,
      projectId: null,
      snapshotHash: null,
      allowNetwork: true,
    });
  }
  async startGameTests(projectId, snapshotHash, { allowNetwork = false, approval, buildId } = {}) {
    if (this.active.size) throw new AppError(409, 'BUILD_ACTIVE', '已有构建或运行检查正在进行。');
    const snapshot = this.workspaces.get(projectId, snapshotHash),
      build = this.get(buildId);
    if (snapshot.imported) throw new AppError(409, 'IMPORTED_WORKSPACE', '请先重新生成工程。');
    if (!snapshot.files.some((f) => f.path === 'GAME-TEST-PLAN.json'))
      throw new AppError(409, 'GAME_TEST_SETUP', '请重新生成包含服务器检查的工程。');
    const plan = JSON.parse(workspaceFiles(snapshot)['GAME-TEST-PLAN.json']);
    const testSource = snapshot.files.find(
      (f) =>
        f.path ===
        'src/main/java/studio/minemod/testing/m_' + snapshot.modId + '/GeneratedGameChecks.java',
    );
    if (!testSource || testSource.sha256 !== plan.testSourceSha256)
      throw new AppError(409, 'GAME_TEST_SETUP', '固定检查源码与计划不一致，请重新生成。');
    if (approval !== snapshotHash)
      throw new AppError(400, 'BUILD_APPROVAL_REQUIRED', '运行检查需要批准此工程快照。');
    if (!supportsGameTests(snapshot.targetId))
      throw new AppError(422, 'GAME_TEST_UNAVAILABLE', '此目标尚无服务器运行检查适配器。');
    if (
      build.projectId !== projectId ||
      build.snapshotHash !== snapshotHash ||
      build.status !== 'passed' ||
      !build.artifact
    )
      throw new AppError(409, 'BUILD_REQUIRED', '先成功编译同一个工程快照。');
    if (typeof allowNetwork !== 'boolean')
      throw new AppError(400, 'INVALID_INPUT', '联网选项需要为布尔值。');
    return this.launch({
      type: 'game-test',
      projectId,
      snapshotHash,
      allowNetwork,
      snapshot,
      sourceBuildId: buildId,
    });
  }
  launch({
    type,
    projectId,
    snapshotHash,
    allowNetwork,
    snapshot,
    selectedTemplate = TEMPLATE,
    targetId = null,
    sourceBuildId = null,
  }) {
    const id = randomUUID();
    const record = {
      id,
      type,
      projectId,
      snapshotHash,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      allowNetwork,
      template: snapshot?.template ?? selectedTemplate,
      targetId: snapshot?.targetId ?? targetId,
      image: snapshot?.targetId?.startsWith('bedrock-')
        ? null
        : (snapshot?.template?.builderImage ?? selectedTemplate.builderImage),
      runnerSha256: sha256(readFileSync(script)),
      log: '',
      artifact: null,
      gameTested: false,
      ...(type === 'game-test' ? { sourceBuildId, gameNetworkDisabled: true } : {}),
    };
    this.records.write(id, record);
    const job = { record, child: null, cancelReason: null, timer: null };
    this.active.set(id, job);
    void this.run(job, snapshot).catch(async () => {
      job.child?.kill('SIGTERM');
      if (['build', 'game-test'].includes(job.record.type))
        await this.removeContainer(job.record.id);
      this.finish(
        job,
        'failed',
        record.targetId?.startsWith('bedrock-')
          ? '本地包校验失败，请检查工程文件与资源引用。'
          : '构建启动失败，请检查 Docker、镜像与数据目录权限。',
      );
    });
    return record;
  }
  log(job, chunk) {
    job.record.log = sanitize(job.record.log + chunk).replaceAll(this.root, '[build-data]');
    this.records.write(job.record.id, job.record);
  }
  finish(job, status, message = '') {
    if (TERMINAL.has(job.record.status)) return;
    clearTimeout(job.timer);
    job.record.status = status;
    job.record.finishedAt = new Date().toISOString();
    if (message) job.record.log = sanitize(job.record.log + '\n' + message);
    this.records.write(job.record.id, job.record);
    if (job.record.type === 'game-test' && job.record.sourceBuildId) {
      try {
        const parent = this.get(job.record.sourceBuildId);
        parent.latestServerCheck = { id: job.record.id, status, finishedAt: job.record.finishedAt };
        parent.log = sanitize(
          (parent.log ?? '') + '\n[临时服务器检查 ' + status + '，客户端视觉未验]',
        );
        this.records.write(parent.id, parent);
      } catch {
        /* The primary result remains readable even if a separate parent record is damaged. */
      }
    }
    this.active.delete(job.record.id);
  }
  async run(job, snapshot) {
    const record = job.record,
      id = record.id;
    if (snapshot?.targetId === 'bedrock-1.21.60') {
      record.status = 'running';
      record.startedAt = new Date().toISOString();
      const bytes = packageBedrock(snapshot);
      const artifactDir = join(this.root, 'artifacts', id);
      mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(artifactDir, 'mod.mcaddon'), bytes, { flag: 'wx', mode: 0o600 });
      record.artifact = {
        name: snapshot.modId + '-1.0.0.mcaddon',
        format: 'mcaddon',
        size: bytes.length,
        sha256: sha256(bytes),
      };
      this.finish(
        job,
        'passed',
        '行为包、资源包 JSON、依赖关系和 ZIP 完整性校验通过；没有执行 Gradle 或游戏实测。',
      );
      return;
    }
    const status = await this.status(record.targetId ?? undefined);
    if (job.cancelReason) {
      this.finish(job, job.cancelReason);
      return;
    }
    if (!status.available || (['build', 'game-test'].includes(record.type) && !status.imageReady)) {
      if (record.type === 'game-test') record.failureKind = 'environment';
      this.finish(job, 'failed', status.reason);
      return;
    }
    let args;
    if (record.type === 'prepare') args = ['pull', record.image];
    else {
      const work = join(this.root, 'runs', id, 'workspace'),
        cache = join(this.root, 'cache');
      mkdirSync(work, { recursive: true, mode: 0o700 });
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      for (const [path, data] of Object.entries(workspaceFiles(snapshot))) {
        const dest = join(work, path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data, { flag: 'wx', mode: path === 'gradlew' ? 0o700 : 0o600 });
      }
      args = [
        'run',
        '--rm',
        '--name',
        'minemod-' + id,
        '--label',
        'minemod.run=' + id,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--memory=4g',
        '--cpus=2',
        '--pids-limit=256',
        '--user',
        String(process.getuid?.() ?? 1000) + ':' + String(process.getgid?.() ?? 1000),
        '--tmpfs',
        '/tmp:rw,nosuid,size=1g',
        '--workdir',
        '/workspace',
        '--mount',
        'type=bind,src=' + work + ',dst=/workspace',
        '--mount',
        'type=bind,src=' + cache + ',dst=/cache',
        '--mount',
        'type=bind,src=' + script + ',dst=/run/minemod-build.sh,readonly',
      ];
      if (!record.allowNetwork) args.push('--network', 'none');
      const cert = process.env.CODEX_PROXY_CERT;
      if (cert && existsSync(cert) && !/[\r\n,]/.test(cert))
        args.push(
          '--mount',
          'type=bind,src=' + resolve(cert) + ',dst=/run/minemod-proxy-ca.pem,readonly',
        );
      args.push(
        record.image,
        'bash',
        '/run/minemod-build.sh',
        record.allowNetwork ? 'online' : 'offline',
        record.type === 'game-test' ? 'prepare-game' : 'build',
        record.targetId.startsWith('fabric-')
          ? 'fabric'
          : record.targetId.startsWith('forge-')
            ? 'forge'
            : 'neoforge',
      );
    }
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    this.records.write(id, record);
    const phases = [args];
    if (record.type === 'game-test') {
      const offline = [...args];
      offline[offline.length - 3] = 'offline';
      offline[offline.length - 2] = 'game';
      if (record.allowNetwork) offline.splice(1, 0, '--network', 'none');
      phases.push(offline);
    }
    job.timer = setTimeout(() => {
      void this.cancel(id, 'timed_out');
    }, 600000);
    job.timer.unref();
    let code = 0;
    for (const [phaseIndex, phaseArgs] of phases.entries()) {
      if (job.cancelReason) break;
      if (record.type === 'game-test') {
        record.phase = phaseIndex ? 'server-game' : 'runtime-preparation';
        this.records.write(id, record);
      }
      if (record.type === 'game-test')
        this.log(
          job,
          phaseIndex ? '\n[服务器运行检查：网络已关闭]\n' : '\n[准备固定游戏运行依赖]\n',
        );
      code = await new Promise((resolve) => {
        const child = spawn('docker', [...baseArgs, ...phaseArgs], {
          env: environment(),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
        job.child = child;
        child.stdout.on('data', (chunk) => this.log(job, chunk.toString()));
        child.stderr.on('data', (chunk) => this.log(job, chunk.toString()));
        child.once('error', () => resolve(-1));
        child.once('close', (exit) => resolve(exit));
      });
      if (code !== 0) break;
    }
    if (job.cancelReason) {
      await this.removeContainer(id);
      this.finish(job, job.cancelReason);
      return;
    }
    if (code !== 0) {
      if (record.type === 'game-test')
        record.failureKind = record.phase === 'runtime-preparation' ? 'environment' : 'game-check';
      this.finish(job, 'failed', '构建未通过（退出码 ' + code + '）。旧的成功产物仍可下载。');
      return;
    }
    if (record.type === 'game-test') {
      try {
        const files = workspaceFiles(snapshot),
          plan = JSON.parse(files['GAME-TEST-PLAN.json']);
        if (
          plan.version !== 1 ||
          plan.targetId !== record.targetId ||
          plan.modId !== snapshot.modId
        )
          throw new Error('plan');
        const path = join(this.root, 'runs', id, 'workspace', 'build', 'minemod-game-tests.jsonl');
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('receipt');
        record.tests = parseGameTestReceipt(readFileSync(path), plan);
        record.gameTested = true;
        record.gameTestScope = 'headless-server';
        record.clientGameTested = false;
        const parent = this.get(record.sourceBuildId);
        parent.serverTests = { id: record.id, status: 'passed', ...record.tests };
        parent.gameTested = true;
        parent.gameTestScope = 'headless-server';
        parent.clientGameTested = false;
        this.records.write(parent.id, parent);
        this.finish(
          job,
          'passed',
          'Minecraft 临时服务器运行检查通过；没有进行客户端视觉与多人游戏验收。',
        );
      } catch {
        this.finish(job, 'failed', '未取得与当前工程匹配的完整服务器检查报告。');
      }
      return;
    }
    if (record.type === 'build') {
      const file = join(
        this.root,
        'runs',
        id,
        'workspace',
        'build',
        'libs',
        snapshot.modId + '-1.0.0.jar',
      );
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('artifact');
        const jar = readFileSync(file);
        if (snapshot.targetId?.startsWith('forge-') || snapshot.targetId?.startsWith('neoforge-')) {
          const meta = JSON.parse(readZipEntry(jar, 'minemod-target.json'));
          if (
            meta.modId !== snapshot.modId ||
            meta.target.minecraft !== snapshot.template.minecraft ||
            meta.target.loader !== snapshot.template.loader
          )
            throw new Error('manifest');
          const toml = readZipEntry(
            jar,
            'META-INF/' +
              (snapshot.template.loader === 'neoforge' ? 'neoforge.mods.toml' : 'mods.toml'),
          ).toString();
          if (!toml.includes('modId = "' + snapshot.modId + '"')) throw new Error('manifest');
        } else {
          const mod = JSON.parse(readZipEntry(jar, 'fabric.mod.json').toString());
          if (mod.id !== snapshot.modId || mod.depends?.minecraft !== snapshot.template.minecraft)
            throw new Error('manifest');
        }
        readZipEntry(jar, 'studio/minemod/generated/m_' + snapshot.modId + '/GeneratedMod.class');
        const artifactDir = join(this.root, 'artifacts', id);
        mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(artifactDir, 'mod.jar'), jar, { flag: 'wx', mode: 0o600 });
        record.artifact = {
          name: snapshot.modId + '-1.0.0.jar',
          format: 'jar',
          size: jar.length,
          sha256: sha256(jar),
        };
      } catch {
        this.finish(
          job,
          'failed',
          'Gradle 退出成功，但产物缺失或 JAR 内容校验失败；不会提供未验证的 JAR。',
        );
        return;
      }
    }
    this.finish(
      job,
      'passed',
      record.type === 'build'
        ? '真实 Gradle 构建与 JAR 结构校验通过。尚未进行游戏实测。'
        : '固定版本构建镜像已准备。',
    );
  }
  async removeContainer(id) {
    try {
      await this.docker(['rm', '--force', 'minemod-' + id]);
    } catch {}
  }
  async cancel(id, reason = 'cancelled') {
    const job = this.active.get(id);
    if (!job) return { cancelled: false };
    job.cancelReason = reason;
    if (['build', 'game-test'].includes(job.record.type)) await this.removeContainer(id);
    job.child?.kill('SIGTERM');
    return { cancelled: true };
  }
  artifact(id) {
    const record = this.get(id);
    if (record.status !== 'passed' || !record.artifact)
      throw new AppError(409, 'ARTIFACT_UNAVAILABLE', '此任务没有经过验证的构建产物。');
    const path = join(
      this.root,
      'artifacts',
      id,
      record.artifact.format === 'mcaddon' ? 'mod.mcaddon' : 'mod.jar',
    );
    if (!lstatSync(path).isFile()) throw new AppError(409, 'ARTIFACT_CORRUPT', '产物文件无效。');
    const bytes = readFileSync(path);
    if (bytes.length !== record.artifact.size || sha256(bytes) !== record.artifact.sha256)
      throw new AppError(409, 'ARTIFACT_CORRUPT', '产物校验失败。');
    return { record, bytes };
  }
  gameTestReport(id) {
    const record = this.get(id),
      expected = record.imported ? record.externalValidation?.sha256 : record.tests?.sha256;
    if (
      !expected ||
      (!record.imported && (record.type !== 'game-test' || record.status !== 'passed'))
    )
      throw new AppError(409, 'GAME_TEST_REPORT', '此任务没有完整服务器检查报告。');
    const path = record.imported
      ? join(this.root, 'test-reports', id + '.jsonl')
      : join(this.root, 'runs', id, 'workspace', 'build', 'minemod-game-tests.jsonl');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new AppError(409, 'GAME_TEST_REPORT', '服务器报告不是有效普通文件。');
    const bytes = readFileSync(path);
    if (sha256(bytes) !== expected)
      throw new AppError(409, 'GAME_TEST_REPORT', '服务器报告哈希不匹配。');
    return { record, bytes };
  }
  async close() {
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
  }
}
