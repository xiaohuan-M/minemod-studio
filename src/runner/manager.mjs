import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { JsonDirectory } from '../storage/json-directory.mjs';
import { TEMPLATE, workspaceFiles } from '../engineering/generator.mjs';
import { sha256, readZipEntry } from '../core/archive.mjs';
import { AppError } from '../core/errors.mjs';
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
export async function builderStatus() {
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
      image: TEMPLATE.builderImage,
      reason: 'Docker 未运行或本机守护进程不可访问。请安装并启动 Docker；源码导出仍可使用。',
    };
  }
  try {
    await executeDocker(['image', 'inspect', TEMPLATE.builderImage, '--format', '{{.Id}}']);
    imageReady = true;
  } catch {}
  return {
    available: true,
    dockerVersion,
    imageReady,
    image: TEMPLATE.builderImage,
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
        if (record.type === 'build') void this.removeContainer(id);
      }
    }
  }
  async docker(args, options = {}) {
    return executeDocker(args, options);
  }
  async status() {
    return builderStatus();
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
    if (approval !== snapshotHash)
      throw new AppError(400, 'BUILD_APPROVAL_REQUIRED', '请审查此工程快照，并明确批准构建。');
    if (typeof allowNetwork !== 'boolean')
      throw new AppError(400, 'INVALID_INPUT', '联网选项必须为布尔值。');
    return this.launch({ type: 'build', projectId, snapshotHash, allowNetwork, snapshot });
  }
  async prepare(approved) {
    if (approved !== true)
      throw new AppError(400, 'BUILD_APPROVAL_REQUIRED', '下载构建镜像需要明确确认联网。');
    if (this.active.size) throw new AppError(409, 'BUILD_ACTIVE', '已有任务运行。');
    return this.launch({
      type: 'prepare',
      projectId: null,
      snapshotHash: null,
      allowNetwork: true,
    });
  }
  launch({ type, projectId, snapshotHash, allowNetwork, snapshot }) {
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
      template: TEMPLATE,
      image: TEMPLATE.builderImage,
      runnerSha256: sha256(readFileSync(script)),
      log: '',
      artifact: null,
      gameTested: false,
    };
    this.records.write(id, record);
    const job = { record, child: null, cancelReason: null, timer: null };
    this.active.set(id, job);
    void this.run(job, snapshot).catch(async () => {
      job.child?.kill('SIGTERM');
      if (job.record.type === 'build') await this.removeContainer(job.record.id);
      this.finish(job, 'failed', '构建启动失败，请检查 Docker、镜像与数据目录权限。');
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
    this.active.delete(job.record.id);
  }
  async run(job, snapshot) {
    const record = job.record,
      id = record.id;
    const status = await this.status();
    if (job.cancelReason) {
      this.finish(job, job.cancelReason);
      return;
    }
    if (!status.available || (record.type === 'build' && !status.imageReady)) {
      this.finish(job, 'failed', status.reason);
      return;
    }
    let args;
    if (record.type === 'prepare') args = ['pull', TEMPLATE.builderImage];
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
        TEMPLATE.builderImage,
        'bash',
        '/run/minemod-build.sh',
        record.allowNetwork ? 'online' : 'offline',
      );
    }
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    this.records.write(id, record);
    const code = await new Promise((resolve) => {
      const child = spawn('docker', [...baseArgs, ...args], {
        env: environment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      job.child = child;
      child.stdout.on('data', (chunk) => this.log(job, chunk.toString()));
      child.stderr.on('data', (chunk) => this.log(job, chunk.toString()));
      child.once('error', () => resolve(-1));
      child.once('close', (exit) => resolve(exit));
      job.timer = setTimeout(() => {
        void this.cancel(id, 'timed_out');
      }, 600000);
      job.timer.unref();
    });
    if (job.cancelReason) {
      await this.removeContainer(id);
      this.finish(job, job.cancelReason);
      return;
    }
    if (code !== 0) {
      this.finish(job, 'failed', '构建未通过（退出码 ' + code + '）。旧的成功产物仍可下载。');
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
        const mod = JSON.parse(readZipEntry(jar, 'fabric.mod.json').toString());
        if (mod.id !== snapshot.modId || mod.depends?.minecraft !== TEMPLATE.minecraft)
          throw new Error('manifest');
        readZipEntry(jar, 'studio/minemod/generated/m_' + snapshot.modId + '/GeneratedMod.class');
        const artifactDir = join(this.root, 'artifacts', id);
        mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
        writeFileSync(join(artifactDir, 'mod.jar'), jar, { flag: 'wx', mode: 0o600 });
        record.artifact = {
          name: snapshot.modId + '-1.0.0.jar',
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
    if (job.record.type === 'build') await this.removeContainer(id);
    job.child?.kill('SIGTERM');
    return { cancelled: true };
  }
  artifact(id) {
    const record = this.get(id);
    if (record.status !== 'passed' || !record.artifact)
      throw new AppError(409, 'ARTIFACT_UNAVAILABLE', '此任务没有经过验证的构建产物。');
    const path = join(this.root, 'artifacts', id, 'mod.jar');
    if (!lstatSync(path).isFile()) throw new AppError(409, 'ARTIFACT_CORRUPT', '产物文件无效。');
    const bytes = readFileSync(path);
    if (bytes.length !== record.artifact.size || sha256(bytes) !== record.artifact.sha256)
      throw new AppError(409, 'ARTIFACT_CORRUPT', '产物校验失败。');
    return { record, bytes };
  }
  async close() {
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
  }
}
