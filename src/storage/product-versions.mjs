import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonDirectory } from './json-directory.mjs';
import { sha256 } from '../core/archive.mjs';
import { specHash, validateModSpec } from '../core/mod-spec.mjs';
import { assertProjectId } from '../core/project.mjs';
import { AppError } from '../core/errors.mjs';

const fail = () => {
  throw new AppError(409, 'VERSION_CORRUPT', '作品版本或关联文件不完整，请从完整备份恢复。');
};
export function signVersion(record) {
  const { checksum: _checksum, ...payload } = record;
  return { ...payload, checksum: sha256(JSON.stringify(payload)) };
}
/** An immutable manifest joins the complete project state to immutable assets/source/artifacts. */
export class ProductVersions {
  constructor(dataDir, store, { assets, workspaces, builds }) {
    this.root = join(dataDir, 'versions');
    Object.assign(this, { store, assets, workspaces, builds });
  }
  records(projectId) {
    assertProjectId(projectId);
    return new JsonDirectory(join(this.root, projectId));
  }
  verify(record) {
    const { checksum, ...payload } = record;
    if (
      checksum !== sha256(JSON.stringify(payload)) ||
      record.format !== 'minemod-version' ||
      record.version !== 1
    )
      fail();
    assertProjectId(record.id);
    assertProjectId(record.projectId);
    if (
      record.project.id !== record.projectId ||
      !Array.isArray(record.buildIds) ||
      !Array.isArray(record.assets)
    )
      fail();
    if (specHash(validateModSpec(record.project.spec)) !== record.project.specHash) fail();
    const required = [
      ...record.project.spec.items,
      ...(record.project.spec.blocks ?? []),
      ...(record.project.spec.entities ?? []),
    ]
      .flatMap((item) => [item.textureAsset, item.modelAsset])
      .filter(Boolean);
    if (required.some((id) => !record.assets.some((a) => a.id === id))) fail();
    for (const ref of record.assets) if (this.assets.get(ref.id).sha256 !== ref.sha256) fail();
    if (record.workspaceHash) {
      const w = this.workspaces.get(record.projectId, record.workspaceHash);
      if (
        w.specHash !== record.project.specHash ||
        w.assetIds.some((id) => !record.assets.some((a) => a.id === id))
      )
        fail();
    }
    for (const id of record.buildIds) {
      const build = this.builds.get(id);
      if (build.projectId !== record.projectId || build.snapshotHash !== record.workspaceHash)
        fail();
      if (build.status === 'passed') this.builds.artifact(id);
    }
    return record;
  }
  get(projectId, id) {
    const record = this.records(projectId).read(id);
    if (record.projectId !== projectId || record.id !== id) fail();
    return this.verify(record);
  }
  list(projectId) {
    return this.records(projectId)
      .ids()
      .map((id) => this.get(projectId, id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  summary(record) {
    return {
      id: record.id,
      projectId: record.projectId,
      label: record.label,
      createdAt: record.createdAt,
      specHash: record.project.specHash,
      workspaceHash: record.workspaceHash,
      buildIds: record.buildIds,
      assetCount: record.assets.length,
      taskId: record.taskId ?? null,
      imported: !!record.imported,
    };
  }
  capture(projectId, { label = '保存作品版本', taskId = null } = {}) {
    const project = this.store.get(projectId);
    if (!project.spec) throw new AppError(409, 'SPEC_REQUIRED', '先制作内容后再保存作品版本。');
    if (typeof label !== 'string' || !label.trim() || label.length > 120)
      throw new AppError(422, 'INVALID_INPUT', '版本说明需要 1–120 字。');
    if (this.records(projectId).ids().length >= 100)
      throw new AppError(409, 'VERSION_LIMIT', '已保存 100 个完整作品版本，请备份后整理。');
    const workspaceHash = project.workspaceHash ?? null;
    const ids = new Set(
      [...project.spec.items, ...(project.spec.blocks ?? []), ...(project.spec.entities ?? [])]
        .flatMap((item) => [item.textureAsset, item.modelAsset])
        .filter(Boolean),
    );
    if (workspaceHash)
      for (const id of this.workspaces.get(projectId, workspaceHash).assetIds) ids.add(id);
    const record = signVersion({
      format: 'minemod-version',
      version: 1,
      id: randomUUID(),
      projectId,
      label: label.trim(),
      taskId,
      createdAt: new Date().toISOString(),
      project: structuredClone(project),
      workspaceHash,
      assets: [...ids].map((id) => ({ id, sha256: this.assets.get(id).sha256 })),
      buildIds: workspaceHash
        ? this.builds
            .list(projectId)
            .filter((b) => b.snapshotHash === workspaceHash && b.status === 'passed')
            .map((b) => b.id)
        : [],
    });
    this.verify(record);
    return this.records(projectId).write(record.id, record);
  }
  restore(projectId, id, revision) {
    const current = this.store.get(projectId);
    this.store.assertRevision(current, revision);
    const saved = this.get(projectId, id);
    if (current.spec) this.capture(projectId, { label: '恢复前自动保存' });
    // Preserve the replaced state and advance the current revision; never revive executable approvals.
    const updated = this.store.setSpec(projectId, saved.project.spec, revision, {
      provider: 'version-restore',
      demo: false,
      versionId: id,
    });
    return this.store.save({
      ...saved.project,
      revision: updated.revision,
      specHistory: updated.specHistory,
      confirmedSpecHash: null,
      approvedWorkspaceHash: null,
      workspaceHash: saved.workspaceHash,
      lastWorkspaceHash: saved.workspaceHash,
      status: 'awaiting_review',
      restoredVersionId: id,
      specSource: updated.specSource,
      updatedAt: new Date().toISOString(),
    });
  }
}
