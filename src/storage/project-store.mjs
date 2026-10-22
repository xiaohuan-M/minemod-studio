import { mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertProjectId, createProject } from '../core/project.mjs';
import { AppError } from '../core/errors.mjs';
import { validateModSpec, specHash } from '../core/mod-spec.mjs';

const HISTORY_LIMIT = 20;

function assertStoredSpec(record) {
  try {
    if (record.specHash !== specHash(record.spec) || (record.confirmedSpecHash && record.confirmedSpecHash !== record.specHash)) throw new Error('Invalid spec hash');
  } catch { throw new Error('Invalid stored spec'); }
}

export class ProjectStore {
  constructor(dataDir) {
    const requestedRoot = resolve(dataDir, 'projects');
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    this.root = realpathSync(requestedRoot);
  }

  path(id) {
    assertProjectId(id);
    return join(this.root, `${id}.json`);
  }

  get(id) {
    const file = this.path(id);
    try {
      if (!lstatSync(file).isFile()) throw new AppError(409, 'INVALID_PROJECT_FILE', '项目文件必须是普通文件。');
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.schemaVersion !== 1 || value.id !== id) throw new Error('Invalid project record');
      const project = { revision: 0, spec: null, specSource: null, specHash: null, confirmedSpecHash: null, specHistory: [], ...value };
      if (!Number.isSafeInteger(project.revision) || project.revision < 0) throw new Error('Invalid revision');
      if (project.spec) {
        assertStoredSpec(project);
      } else if (project.specHash || project.confirmedSpecHash) throw new Error('Missing spec');
      if (!Array.isArray(project.specHistory) || project.specHistory.length > HISTORY_LIMIT) throw new Error('Invalid history');
      const revisions = new Set();
      for (const entry of project.specHistory) {
        if (!Number.isSafeInteger(entry.revision) || entry.revision < 0 || entry.revision >= project.revision || revisions.has(entry.revision)) throw new Error('Invalid history revision');
        revisions.add(entry.revision);
        assertStoredSpec(entry);
      }
      return project;
    } catch (error) {
      if (error.code === 'ENOENT') throw new AppError(404, 'PROJECT_NOT_FOUND', '没有找到该项目。');
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'PROJECT_CORRUPT', '项目文件损坏，请从备份恢复。');
    }
  }

  list() {
    // A malformed record is reported rather than silently hidden or overwritten.
    return readdirSync(this.root)
      .filter((file) => /^[0-9a-f-]{36}\.json$/.test(file))
      .map((file) => this.get(file.slice(0, -5)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  save(project) {
    const file = this.path(project.id);
    const temp = join(dirname(file), `.${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      renameSync(temp, file);
    } finally {
      try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return project;
  }

  create(input) {
    return this.save(createProject(input));
  }

  plan(id, provider) {
    const project = this.get(id);
    const plan = provider.plan(project);
    return this.save({ ...project, plan, status: project.spec ? project.status : 'planned', revision: project.revision + 1, updatedAt: new Date().toISOString() });
  }

  assertRevision(project, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new AppError(400, 'INVALID_INPUT', '请提供项目 revision。');
    if (project.revision !== revision) throw new AppError(409, 'PROJECT_CHANGED', '项目已更新，请重新打开项目后再操作。');
  }

  setSpec(id, input, revision, source = { provider: 'manual', demo: false }) {
    const project = this.get(id);
    this.assertRevision(project, revision);
    const spec = validateModSpec(input);
    const specHistory = [...project.specHistory];
    if (project.spec) specHistory.push({revision:project.revision,spec:project.spec,specHash:project.specHash,
      specSource:project.specSource,confirmedSpecHash:project.confirmedSpecHash,savedAt:project.updatedAt});
    return this.save({ ...project, spec, specHash: specHash(spec), specSource: source, confirmedSpecHash: null,
      specHistory: specHistory.slice(-HISTORY_LIMIT),
      status: 'awaiting_review', revision: project.revision + 1, updatedAt: new Date().toISOString() });
  }

  history(id) {
    return this.get(id).specHistory.toReversed().map((entry) => ({revision:entry.revision,savedAt:entry.savedAt,
      specHash:entry.specHash,specSource:entry.specSource,confirmed:!!entry.confirmedSpecHash,
      displayName:entry.spec.displayName,itemCount:entry.spec.items.length,recipeCount:entry.spec.recipes.length}));
  }

  snapshot(id, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new AppError(400, 'INVALID_INPUT', '历史版本号不正确。');
    const entry = this.get(id).specHistory.find((entry) => entry.revision === revision);
    if (!entry) throw new AppError(404, 'SNAPSHOT_NOT_FOUND', '历史版本不存在或已超出最近 20 个版本。');
    return entry;
  }

  restoreSpec(id, fromRevision, revision) {
    const project = this.get(id);
    this.assertRevision(project, revision);
    const entry = this.snapshot(id, fromRevision);
    return this.setSpec(id, entry.spec, revision, {...entry.specSource,restoredFromRevision:fromRevision});
  }

  confirmSpec(id, revision) {
    const project = this.get(id);
    this.assertRevision(project, revision);
    if (!project.spec) throw new AppError(409, 'SPEC_REQUIRED', '请先生成或保存规格。');
    return this.save({ ...project, confirmedSpecHash: specHash(project.spec), status: 'spec_confirmed',
      revision: project.revision + 1, updatedAt: new Date().toISOString() });
  }
}
