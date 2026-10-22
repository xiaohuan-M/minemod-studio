import { join } from 'node:path';
import { JsonDirectory } from './json-directory.mjs';
import { assertProjectId } from '../core/project.mjs';
import { AppError } from '../core/errors.mjs';
import { sha256, safeArchivePath } from '../core/archive.mjs';
import { generateWorkspace, diffWorkspaces, workspaceFiles } from '../engineering/generator.mjs';
export class WorkspaceStore {
  constructor(dataDir, assetStore) {
    this.root = join(dataDir, 'workspaces');
    this.assets = assetStore;
  }
  records(id) {
    assertProjectId(id);
    return new JsonDirectory(join(this.root, id));
  }
  generate(project) {
    if (!project.spec || project.confirmedSpecHash !== project.specHash)
      throw new AppError(409, 'SPEC_UNCONFIRMED', '请先审查并确认当前规格。');
    const refs = new Set(
      [...project.spec.items, ...(project.spec.blocks ?? []), ...(project.spec.entities ?? [])]
        .flatMap((item) => [item.textureAsset, item.modelAsset])
        .filter(Boolean),
    );
    const generated = generateWorkspace(
      project.spec,
      [...refs].map((id) => this.assets.get(id)),
    );
    const records = this.records(project.id);
    let previous = null;
    if (project.workspaceHash ?? project.lastWorkspaceHash)
      previous = this.get(project.id, project.workspaceHash ?? project.lastWorkspaceHash);
    const snapshot = {
      ...generated,
      projectId: project.id,
      projectRevision: project.revision,
      createdAt: new Date().toISOString(),
      changes: diffWorkspaces(previous, generated),
    };
    const ids = records.ids();
    if (ids.includes(snapshot.hash)) {
      const existing = this.get(project.id, snapshot.hash);
      if (!existing.imported) return existing;
      // Identical regeneration establishes trusted generator provenance again.
    }
    if (ids.length >= 100)
      throw new AppError(409, 'WORKSPACE_LIMIT', '工程达到 100 个快照，请导出备份后整理数据。');
    return records.write(snapshot.hash, snapshot);
  }
  get(projectId, hash) {
    const snapshot = this.records(projectId).read(hash);
    if (
      snapshot.hash !== hash ||
      snapshot.projectId !== projectId ||
      !Array.isArray(snapshot.files) ||
      snapshot.files.length > 2048
    )
      throw new AppError(500, 'WORKSPACE_CORRUPT', '工程快照元数据损坏。');
    let total = 0;
    const paths = new Set();
    for (const file of snapshot.files) {
      safeArchivePath(file.path);
      if (paths.has(file.path)) throw new AppError(500, 'WORKSPACE_CORRUPT', '工程文件重复。');
      paths.add(file.path);
      const bytes = Buffer.from(file.content, 'base64');
      total += bytes.length;
      if (bytes.length !== file.size || sha256(bytes) !== file.sha256 || total > 32 * 1024 * 1024)
        throw new AppError(500, 'WORKSPACE_CORRUPT', '工程文件校验失败。');
    }
    if (
      sha256(
        JSON.stringify(
          snapshot.files.map(({ path, size, sha256: hash }) => ({ path, size, sha256: hash })),
        ),
      ) !== hash
    )
      throw new AppError(500, 'WORKSPACE_CORRUPT', '工程快照哈希不匹配。');
    return snapshot;
  }
  list(id) {
    return this.records(id)
      .ids()
      .map((hash) => this.summary(this.get(id, hash)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  summary(snapshot) {
    const { files, ...metadata } = snapshot;
    return { ...metadata, files: files.map(({ content, ...file }) => file) };
  }
  files(projectId, hash) {
    return workspaceFiles(this.get(projectId, hash));
  }
}
