import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonDirectory } from '../storage/json-directory.mjs';
import { AppError } from '../core/errors.mjs';
import { validateTexture } from '../core/assets.mjs';
import { validateAnimation } from '../core/animation.mjs';
import { ApiKnowledge } from './knowledge.mjs';
import { codeContext } from '../engineering/code-changes.mjs';
import { supportsGameTests } from '../engineering/game-tests.mjs';

const terminal = new Set(['passed', 'failed', 'cancelled', 'interrupted']);
export const CREATION_LIMITS = Object.freeze({ maxCalls: 256, maxRepairs: 3 });
export function creationOptions(input) {
  const options = {
    instruction: input.instruction ?? '',
    textures: input.textures ?? true,
    models: input.models ?? true,
    code: input.code ?? true,
    gameTests: input.gameTests ?? false,
    maxCalls: input.maxCalls ?? 48,
    maxRepairs: input.maxRepairs ?? 2,
    allowNetwork: input.allowNetwork ?? false,
  };
  if (
    typeof options.instruction !== 'string' ||
    options.instruction.length > 4000 ||
    ['textures', 'models', 'code', 'gameTests', 'allowNetwork'].some(
      (k) => typeof options[k] !== 'boolean',
    ) ||
    !Number.isInteger(options.maxCalls) ||
    options.maxCalls < 1 ||
    options.maxCalls > CREATION_LIMITS.maxCalls ||
    !Number.isInteger(options.maxRepairs) ||
    options.maxRepairs < 0 ||
    options.maxRepairs > CREATION_LIMITS.maxRepairs
  )
    throw new AppError(
      422,
      'INVALID_CREATION',
      '创作选项无效：最多 256 次模型调用、3 轮修复，需求最多 4000 字。',
    );
  if (input.approved !== true)
    throw new AppError(
      400,
      'CREATION_APPROVAL_REQUIRED',
      '请确认本轮自动创作、素材调用与具体工程构建。',
    );
  return options;
}
function resizeTexture(input, size) {
  const value = validateTexture(input);
  if (value.width === size) return value;
  return validateTexture({
    width: size,
    height: size,
    pixels: Array.from(
      { length: size * size },
      (_, i) =>
        value.pixels[
          Math.floor((Math.floor(i / size) * value.width) / size) * value.width +
            Math.floor(((i % size) * value.width) / size)
        ],
    ),
  });
}

/** Durable application orchestration. Providers and runners stay replaceable; no HTTP calls to ourselves. */
export class CreationManager {
  constructor(dataDir, store, workshop) {
    Object.assign(this, { store, ...workshop });
    this.records = new JsonDirectory(join(dataDir, 'creations'));
    this.active = new Map();
    this.knowledge = new ApiKnowledge(dataDir);
    for (const id of this.records.ids()) {
      const task = this.get(id);
      if (!terminal.has(task.status)) {
        task.status = 'interrupted';
        this.event(task, 'interrupted', '服务中断，已完成步骤保留；确认后可继续。');
      }
    }
  }
  get(id) {
    const record = this.records.read(id);
    if (record.id !== id || record.format !== 'minemod-creation' || !Array.isArray(record.events))
      throw new AppError(500, 'CREATION_CORRUPT', '创作任务记录损坏。');
    return record;
  }
  list(projectId) {
    return this.records
      .ids()
      .map((id) => this.get(id))
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  isActive(projectId) {
    return [...this.active.values()].some((job) => job.task.projectId === projectId);
  }
  event(task, stage, message, extra = {}) {
    task.stage = stage;
    task.updatedAt = new Date().toISOString();
    task.events.push({ seq: task.events.length + 1, at: task.updatedAt, stage, message, ...extra });
    return this.records.write(task.id, task);
  }
  current(task) {
    const project = this.store.get(task.projectId);
    this.store.assertRevision(project, task.expectedRevision);
    return project;
  }
  update(task, project) {
    task.expectedRevision = project.revision;
    this.records.write(task.id, task);
    return project;
  }
  start(projectId, input, provider) {
    const project = this.store.get(projectId),
      options = creationOptions(input);
    this.store.assertRevision(project, input.revision);
    if (this.isActive(projectId))
      throw new AppError(409, 'CREATION_ACTIVE', '该项目已有自动创作任务。');
    if (this.active.size >= 2)
      throw new AppError(429, 'CREATION_LIMIT', '最多同时进行两个自动创作任务。');
    if (this.list(projectId).length >= 100)
      throw new AppError(409, 'CREATION_LIMIT', '项目已有 100 个创作任务，请备份后整理。');
    const task = {
      format: 'minemod-creation',
      version: 1,
      id: randomUUID(),
      projectId,
      status: 'queued',
      stage: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expectedRevision: project.revision,
      options,
      provider: {
        model: provider.info.model,
        baseUrl: provider.info.baseUrl,
        configurationId: provider.info.configurationId,
      },
      events: [],
      calls: [],
      repairs: 0,
      specComplete: false,
      codeComplete: false,
      previousSnapshotHash: project.workspaceHash ?? project.lastWorkspaceHash ?? null,
      assetJobs: [],
      snapshotHash: null,
      buildId: null,
      gameTestId: null,
      gameTested: false,
      versionId: null,
    };
    this.event(task, 'queued', '本轮自动创作已授权，准备规划、制作素材、生成工程并构建。');
    this.launch(task, provider);
    return structuredClone(task);
  }
  resume(id, input, provider) {
    const task = this.get(id);
    if (!['interrupted', 'cancelled', 'failed'].includes(task.status))
      throw new AppError(409, 'CREATION_ACTIVE', '此任务不需要恢复。');
    const nextOptions = creationOptions({
      ...task.options,
      approved: input.approved,
      maxCalls: input.maxCalls ?? task.options.maxCalls,
      maxRepairs: input.maxRepairs ?? task.options.maxRepairs,
      allowNetwork: input.allowNetwork ?? task.options.allowNetwork,
    });
    if (task.error?.code === 'CREATION_BUDGET' && nextOptions.maxCalls <= task.calls.length)
      throw new AppError(409, 'CREATION_BUDGET', '请提高调用上限并重新确认后继续。');
    task.options = nextOptions;
    if (task.error?.code === 'GAME_ENVIRONMENT') task.gameTestId = null;
    this.current(task);
    this.store.assertRevision(this.store.get(task.projectId), input.revision);
    if (this.isActive(task.projectId) || this.active.size >= 2)
      throw new AppError(409, 'CREATION_ACTIVE', '请等待其他任务结束。');
    task.provider = {
      model: provider.info.model,
      baseUrl: provider.info.baseUrl,
      configurationId: provider.info.configurationId,
    };
    task.status = 'queued';
    task.error = null;
    this.event(task, 'queued', '已重新确认服务与剩余步骤，继续本轮任务。');
    this.launch(task, provider);
    return structuredClone(task);
  }
  launch(task, provider) {
    const controller = new AbortController(),
      job = { task, controller, promise: null };
    this.active.set(task.id, job);
    job.promise = this.run(task, provider, controller.signal)
      .catch((error) => {
        task.status = controller.signal.aborted ? 'cancelled' : 'failed';
        task.error = {
          code: controller.signal.aborted
            ? 'CREATION_CANCELLED'
            : error instanceof AppError
              ? error.code
              : 'CREATION_FAILED',
          message: controller.signal.aborted
            ? '任务已取消；已完成内容保留。'
            : error instanceof AppError
              ? error.message
              : '创作步骤失败，已完成内容保留，请检查模型或构建环境后继续。',
        };
        this.event(task, task.status, task.error.message);
      })
      .finally(() => this.active.delete(task.id));
  }
  async call(task, provider, method, input, signal) {
    signal.throwIfAborted();
    this.current(task);
    if (task.calls.length >= task.options.maxCalls)
      throw new AppError(
        409,
        'CREATION_BUDGET',
        '达到本轮模型调用上限，已停止。提高调用上限并重新确认后可继续，或保存当前作品后发起新一轮。',
      );
    const call = {
      id: randomUUID(),
      method,
      model: provider.info.model,
      configurationId: provider.info.configurationId,
      status: 'running',
      startedAt: new Date().toISOString(),
      usage: null,
    };
    task.calls.push(call);
    this.records.write(task.id, task);
    try {
      const result = await provider[method](input, { signal });
      signal.throwIfAborted();
      this.current(task);
      call.status = 'passed';
      call.usage = result.source?.usage ?? null;
      return result;
    } catch (error) {
      call.status = signal.aborted ? 'cancelled' : 'failed';
      throw error;
    } finally {
      call.finishedAt = new Date().toISOString();
      this.records.write(task.id, task);
    }
  }
  async waitBuild(task, id, signal) {
    let phase = null;
    try {
      for (;;) {
        signal.throwIfAborted();
        this.current(task);
        const build = this.builds.get(id);
        if (build.type === 'game-test' && build.phase && phase !== build.phase) {
          phase = build.phase;
          this.event(
            task,
            'game-tests',
            phase === 'runtime-preparation'
              ? '正在准备固定服务器运行依赖。'
              : '依赖已准备，正在断网执行 Minecraft 服务器检查。',
            { gameTestId: id, phase },
          );
        }
        if (!['queued', 'running'].includes(build.status)) return build;
        await delay(200, undefined, { signal });
      }
    } catch (error) {
      if (signal.aborted) await this.builds.cancel(id);
      throw error;
    }
  }
  async run(task, provider, signal) {
    task.status = 'running';
    this.event(task, 'planning', '生成或继续修改玩法规格。');
    if (!task.beforeVersionId && this.current(task).spec) {
      const latest = this.versions.list(task.projectId)[0];
      task.beforeVersionId =
        latest && JSON.stringify(latest.project) === JSON.stringify(this.current(task))
          ? latest.id
          : this.versions.capture(task.projectId, {
              label: '创作前自动保存',
              taskId: task.id,
            }).id;
      this.records.write(task.id, task);
    }
    for (;;) {
      signal.throwIfAborted();
      if (!task.specComplete) {
        const project = this.current(task);
        let result;
        try {
          result = await this.call(
            task,
            provider,
            'planSpec',
            {
              ...project,
              instruction: task.options.instruction || project.prompt,
              ...(task.failureLog ? { buildFailure: task.failureLog } : {}),
            },
            signal,
          );
        } catch (error) {
          if (
            !signal.aborted &&
            ['PROVIDER_INVALID_SPEC', 'INVALID_SPEC'].includes(error.code) &&
            task.repairs < task.options.maxRepairs
          ) {
            task.repairs++;
            this.event(task, 'repairing', '规格校验失败，使用剩余修复额度重新生成。');
            continue;
          }
          throw error;
        }
        this.update(
          task,
          this.store.setSpec(task.projectId, result.spec, project.revision, result.source, {
            instruction: task.options.instruction || project.prompt,
            reply: '自动创作规格已校验，继续制作素材与工程。' + result.spec.assumptions.join('；'),
          }),
        );
        task.specComplete = true;
        task.codeComplete = false;
        task.assetJobs = [];
        task.snapshotHash = null;
        task.buildId = null;
        task.gameTestId = null;
        task.gameTested = false;
        this.event(task, 'spec', '玩法规格已保存。', { specHash: this.current(task).specHash });
      }
      await this.makeAssets(task, provider, signal);
      let project = this.current(task);
      if (!task.snapshotHash) {
        this.event(task, 'engineering', '生成并校验本轮工程文件。');
        project = this.update(task, this.store.confirmSpec(project.id, project.revision));
        const snapshot = this.workspaces.generate(project);
        project = this.update(
          task,
          this.store.attachWorkspace(project.id, snapshot, project.revision),
        );
        task.snapshotHash = snapshot.hash;
        this.event(task, 'engineering', '工程已生成；本轮授权绑定此快照。', {
          snapshotHash: snapshot.hash,
          changes: snapshot.changes,
        });
      }
      if (project.target.edition === 'java' && task.options.code && !task.codeComplete) {
        if (typeof provider.planCode !== 'function')
          throw new AppError(
            409,
            'PROVIDER_CAPABILITY',
            '当前服务未提供代码生成适配器；可关闭本轮代码扩展，仅使用已支持的规格。',
          );
        this.event(task, 'knowledge', '检索当前版本与加载器的 API 资料。');
        const snapshot = this.workspaces.get(project.id, task.snapshotHash);
        const knowledge = await this.knowledge.search(snapshot.targetId, project.spec, {
          allowNetwork: task.options.allowNetwork,
          signal,
        });
        signal.throwIfAborted();
        this.current(task);
        task.knowledge = knowledge.map(({ text, ...metadata }) => metadata);
        this.event(
          task,
          'coding',
          task.failureLog ? '根据失败日志修复代码。' : '生成或继续修改玩法代码。',
          { sources: task.knowledge },
        );
        try {
          const previous = task.previousSnapshotHash
            ? this.workspaces.get(project.id, task.previousSnapshotHash)
            : null;
          const result = await this.call(
            task,
            provider,
            'planCode',
            {
              project: { ...project, instruction: task.options.instruction || project.prompt },
              files: codeContext(snapshot),
              previousFiles: previous ? codeContext(previous) : [],
              knowledge,
              failureLog: task.failureLog,
            },
            signal,
          );
          const changed = this.workspaces.applyCode(this.current(task), task.snapshotHash, result);
          if (changed.hash !== task.snapshotHash) {
            project = this.update(
              task,
              this.store.attachWorkspace(project.id, changed, this.current(task).revision),
            );
            task.snapshotHash = changed.hash;
          }
          task.codeComplete = true;
          task.buildId = null;
          task.gameTestId = null;
          task.gameTested = false;
          this.event(task, 'coding', '代码修改已校验并记录差异，继续真实编译。', {
            snapshotHash: task.snapshotHash,
            changes: changed.changes,
            summary: result.summary,
          });
        } catch (error) {
          if (
            !signal.aborted &&
            ['PROVIDER_INVALID_CODE', 'INVALID_CODE_CHANGE'].includes(error.code) &&
            task.repairs < task.options.maxRepairs
          ) {
            task.repairs++;
            this.event(task, 'repairing', '代码数据校验失败，使用剩余修复额度重新生成。');
            continue;
          }
          throw error;
        }
      }
      if (!project.target || project.target.edition === 'java') {
        this.event(task, 'environment', '检查固定版本 Java 构建环境。');
        const status = await this.builds.status(
          this.workspaces.get(project.id, task.snapshotHash).targetId,
        );
        signal.throwIfAborted();
        this.current(task);
        if (!status.available) throw new AppError(409, 'BUILDER_UNAVAILABLE', status.reason);
        if (!status.imageReady) {
          if (!task.options.allowNetwork)
            throw new AppError(
              409,
              'BUILDER_IMAGE_REQUIRED',
              '需要先准备构建镜像；本轮未授权联网下载。',
            );
          const prepared = await this.builds.prepare(
            true,
            this.workspaces.get(project.id, task.snapshotHash).targetId,
          );
          this.event(task, 'environment', '下载固定构建镜像。', { prepareId: prepared.id });
          const result = await this.waitBuild(task, prepared.id, signal);
          if (result.status !== 'passed')
            throw new AppError(
              409,
              'BUILDER_UNAVAILABLE',
              '固定镜像准备失败，请查看环境任务记录。',
            );
        }
      }
      project = this.current(task);
      if (
        !task.buildId ||
        ['cancelled', 'interrupted', 'timed_out'].includes(this.builds.get(task.buildId).status)
      ) {
        project = this.update(
          task,
          this.store.approveWorkspace(project.id, task.snapshotHash, project.revision),
        );
        const build = await this.builds.start(project.id, task.snapshotHash, {
          approval: task.snapshotHash,
          allowNetwork: task.options.allowNetwork,
        });
        task.buildId = build.id;
        this.event(task, 'building', '运行真实编译或本地附加包校验。', {
          buildId: build.id,
          snapshotHash: task.snapshotHash,
        });
      }
      let build = await this.waitBuild(task, task.buildId, signal);
      if (
        build.status === 'passed' &&
        task.options.gameTests &&
        supportsGameTests(build.targetId)
      ) {
        if (
          !task.gameTestId ||
          ['cancelled', 'interrupted', 'timed_out'].includes(
            this.builds.get(task.gameTestId).status,
          )
        ) {
          const check = await this.builds.startGameTests(project.id, task.snapshotHash, {
            approval: task.snapshotHash,
            allowNetwork: task.options.allowNetwork,
            buildId: task.buildId,
          });
          task.gameTestId = check.id;
          this.event(task, 'game-tests', '准备依赖并在断网临时 Minecraft 服务器中检查本轮作品。', {
            gameTestId: check.id,
          });
        }
        const checked = await this.waitBuild(task, task.gameTestId, signal);
        if (checked.status === 'passed') task.gameTested = true;
        else build = checked;
      }
      if (build.status === 'passed') {
        task.versionId = this.versions.capture(task.projectId, {
          label: '自动创作完成 · ' + this.current(task).spec.displayName,
          taskId: task.id,
        }).id;
        task.status = 'passed';
        task.error = null;
        this.event(
          task,
          'passed',
          task.gameTested
            ? '作品已构建、服务器检查通过并保存完整版本。客户端视觉与未覆盖玩法仍需验收。'
            : '作品已构建并保存完整版本，可下载产物与源码。游戏行为仍需实际验证。',
          { versionId: task.versionId, buildId: task.buildId, gameTestId: task.gameTestId },
        );
        return;
      }
      if (build.failureKind === 'environment')
        throw new AppError(
          409,
          'GAME_ENVIRONMENT',
          '服务器运行依赖准备失败。请查看检查日志，修复网络/缓存后继续；不会调用模型修改代码来处理环境失败。',
        );
      if (build.status !== 'failed' || task.repairs >= task.options.maxRepairs)
        throw new AppError(
          409,
          'CREATION_BUILD_FAILED',
          '构建未通过，已保存日志与源码；不会交付失败产物。',
        );
      task.repairs++;
      task.failureLog = build.log.slice(-6000);
      if (project.target.edition === 'java' && task.options.code) {
        task.codeComplete = false;
        task.buildId = null;
        task.gameTestId = null;
        task.gameTested = false;
      } else task.specComplete = false;
      this.event(task, 'repairing', '构建失败，带失败日志进入有界修复并重新构建。', {
        buildId: build.id,
        attempt: task.repairs,
      });
    }
  }
  async makeAssets(task, provider, signal) {
    const initial = this.current(task),
      bedrock = initial.target.edition === 'bedrock';
    for (const group of ['items', 'blocks', 'entities'])
      for (const initialOwner of initial.spec[group] ?? []) {
        const kinds = [
          ...(task.options.textures ? ['texture'] : []),
          ...(task.options.models &&
          (group === 'blocks' ||
            (group === 'items' && !bedrock) ||
            (group === 'entities' && bedrock))
            ? ['model']
            : []),
        ];
        for (const kind of kinds) {
          const project = this.current(task),
            owner = project.spec[group].find((o) => o.id === initialOwner.id),
            field = kind + 'Asset';
          if (owner[field]) continue;
          signal.throwIfAborted();
          this.event(
            task,
            'assets',
            '制作' +
              owner.displayName.zh_cn +
              '的' +
              (kind === 'texture' ? '像素贴图' : '立方体模型') +
              '。',
          );
          const result = await this.call(
            task,
            provider,
            'planAsset',
            {
              kind: kind === 'model' && group === 'entities' && bedrock ? 'animated_model' : kind,
              prompt: (
                initial.prompt +
                '。' +
                task.options.instruction +
                '。为' +
                group +
                ' ' +
                owner.id +
                ' ' +
                owner.displayName.zh_cn +
                '制作' +
                (kind === 'texture' ? '16×16 Minecraft 像素贴图' : 'Minecraft 立方体模型') +
                '，风格保持一致。' +
                (kind === 'model' && group === 'entities' && bedrock
                  ? '使用父子骨骼与多立方体分组，并提供 ' +
                    (owner.animationClip ?? 'walk') +
                    ' 动画片段。'
                  : '')
              ).slice(0, 2000),
            },
            signal,
          );
          let data = result.data,
            assetKind = kind;
          if (kind === 'texture' && group === 'entities' && !bedrock)
            data = resizeTexture(data, 64);
          if (kind === 'model' && group === 'entities') {
            data = validateAnimation({
              ...data,
              clips: data.clips ?? [{ name: 'idle', duration: 1, loop: true, tracks: [] }],
            });
            assetKind = 'animated_model';
          }
          if (kind === 'model' && owner.textureAsset)
            data = { ...data, texture: this.assets.get(owner.textureAsset).data };
          const asset = this.assets.create({
            kind: assetKind,
            name: (owner.displayName.zh_cn + ' · 自动' + kind).slice(0, 80),
            data,
            source: ('LLM: ' + (result.source?.model ?? 'configured-provider')).slice(0, 200),
            license: 'AI 生成；请核对服务商条款',
          });
          const current = this.current(task),
            spec = structuredClone(current.spec);
          spec[group].find((o) => o.id === owner.id)[field] = asset.id;
          if (assetKind === 'animated_model') {
            const entity = spec[group].find((o) => o.id === owner.id);
            entity.animationClip ??=
              data.clips.find((c) => c.name === 'walk')?.name ?? data.clips[0].name;
          }
          this.update(
            task,
            this.store.setSpec(current.id, spec, current.revision, current.specSource),
          );
          task.assetJobs.push({ group, ownerId: owner.id, kind, assetId: asset.id });
          this.event(task, 'assets', '素材已校验、保存并绑定。', {
            assetId: asset.id,
            ownerId: owner.id,
            kind,
          });
        }
      }
  }
  async cancel(id) {
    const job = this.active.get(id);
    if (!job) return { cancelled: false };
    job.controller.abort();
    if (job.task.buildId) await this.builds.cancel(job.task.buildId);
    await job.promise;
    return { cancelled: true };
  }
  async close() {
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
  }
}
