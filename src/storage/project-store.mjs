import { mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertProjectId, createProject } from '../core/project.mjs';
import { AppError } from '../core/errors.mjs';

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
      return value;
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
    return this.save({ ...project, plan, status: 'planned', updatedAt: new Date().toISOString() });
  }
}
