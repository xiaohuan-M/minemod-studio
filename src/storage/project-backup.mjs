import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from './project-store.mjs';
import { AssetStore } from './asset-store.mjs';
import { WorkspaceStore } from './workspace-store.mjs';
import { JsonDirectory } from './json-directory.mjs';
import { createProject, assertProjectId } from '../core/project.mjs';
import { identifyTarget } from '../core/targets.ts';
import { validateModel, validateTexture } from '../core/assets.mjs';
import { sha256, readZipEntry } from '../core/archive.mjs';
import { AppError } from '../core/errors.mjs';
const fail = (message) => {
  throw new AppError(422, 'INVALID_BACKUP', message);
};
const LIMIT = 32 * 1024 * 1024;
/** Versioned local backup; validation is completed in staging before any visible project exists. */
export class ProjectBackup {
  constructor(dataDir, store, { assets, workspaces, builds }) {
    this.root = resolve(dataDir);
    Object.assign(this, { store, assets, workspaces, builds });
  }
  export(id) {
    const project = this.store.get(id),
      workspaces = this.workspaces.list(id).map((w) => this.workspaces.get(id, w.hash));
    const refs = new Set(workspaces.flatMap((w) => w.assetIds));
    for (const spec of [project.spec, ...project.specHistory.map((h) => h.spec)].filter(Boolean))
      for (const item of [...spec.items, ...(spec.blocks ?? [])])
        for (const key of ['textureAsset', 'modelAsset']) if (item[key]) refs.add(item[key]);
    const assets = [...refs].map((id) => this.assets.get(id));
    const builds = this.builds.list(id).map((summary) => {
      const record = this.builds.get(summary.id);
      return {
        record,
        ...(record.status === 'passed' && record.artifact
          ? { artifact: this.builds.artifact(record.id).bytes.toString('base64') }
          : {}),
      };
    });
    const payload = {
      format: 'minemod-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project,
      assets,
      workspaces,
      builds,
    };
    const result = { ...payload, checksum: sha256(JSON.stringify(payload)) };
    if (Buffer.byteLength(JSON.stringify(result)) > LIMIT)
      fail('备份超过 32 MiB，请先手动备份整个数据目录。');
    return result;
  }
  import(input) {
    if (!input || input.format !== 'minemod-project' || input.version !== 1)
      fail('不是支持的 MineMod 项目备份。');
    const { checksum, ...payload } = input;
    if (
      Buffer.byteLength(JSON.stringify(input)) > LIMIT ||
      sha256(JSON.stringify(payload)) !== checksum
    )
      fail('备份内容校验失败。');
    if (
      !Array.isArray(input.assets) ||
      input.assets.length > 500 ||
      !Array.isArray(input.workspaces) ||
      input.workspaces.length > 100 ||
      !Array.isArray(input.builds) ||
      input.builds.length > 100
    )
      fail('备份记录数量超限。');
    const old = input.project;
    assertProjectId(old?.id);
    const base = createProject({
      name: old.name,
      prompt: old.prompt,
      targetId: identifyTarget(old.target)?.id,
    });
    if (!identifyTarget(old.target)?.enabled) fail('备份目标当前不可用。');
    const stage = mkdtempSync(join(this.root, '.import-')),
      moved = [];
    try {
      const stagedAssets = new AssetStore(stage),
        stagedWorkspaces = new WorkspaceStore(stage, stagedAssets),
        stagedProjects = new ProjectStore(stage);
      const assetIds = new Set();
      for (const a of input.assets) {
        assertProjectId(a.id);
        if (assetIds.has(a.id)) fail('资源 ID 重复。');
        assetIds.add(a.id);
        // Reuse creation validation, then preserve the immutable referenced identity.
        const checked = stagedAssets.create({
          name: a.name,
          kind: a.kind,
          data: a.data,
          source: a.source,
          license: a.license,
        });
        if (checked.sha256 !== a.sha256) fail('资源哈希不匹配。');
        unlinkSync(stagedAssets.records.path(checked.id));
        stagedAssets.records.write(a.id, {
          ...checked,
          id: a.id,
          createdAt: typeof a.createdAt === 'string' ? a.createdAt : base.createdAt,
        });
        if (existsSync(this.assets.records.path(a.id))) {
          const existing = this.assets.get(a.id);
          if (
            ['sha256', 'kind', 'name', 'source', 'license'].some((k) => existing[k] !== checked[k])
          )
            fail('本机已有同 ID 的不同资源；未覆盖本机数据。');
        }
      }
      const conversation = old.conversation ?? [];
      if (
        !Array.isArray(conversation) ||
        conversation.length > 100 ||
        conversation.some(
          (c) =>
            typeof c.instruction !== 'string' ||
            c.instruction.length > 4000 ||
            typeof c.reply !== 'string' ||
            c.reply.length > 4000,
        )
      )
        fail('对话记录不正确。');
      const project = {
        ...base,
        revision: old.revision,
        spec: old.spec,
        specHash: old.specHash,
        specSource: { provider: 'imported', demo: false },
        specHistory: old.specHistory,
        conversation: conversation.map((c) => ({
          id: randomUUID(),
          at: String(c.at).slice(0, 40),
          instruction: c.instruction,
          reply: c.reply,
          revision: c.revision,
          specHash: c.specHash,
          source: { provider: 'imported', demo: false },
        })),
        status: old.spec ? 'awaiting_review' : 'draft',
        importedFrom: old.id,
      };
      stagedProjects.save(project);
      stagedProjects.get(project.id);
      for (const spec of [project.spec, ...project.specHistory.map((h) => h.spec)].filter(Boolean))
        for (const item of [...spec.items, ...(spec.blocks ?? [])])
          for (const key of ['textureAsset', 'modelAsset'])
            if (item[key] && !assetIds.has(item[key])) fail('备份缺少规格引用的资源。');
      const hashes = new Set();
      for (const w of input.workspaces) {
        if (
          w.projectId !== old.id ||
          hashes.has(w.hash) ||
          !Array.isArray(w.assetIds) ||
          w.assetIds.some((id) => !assetIds.has(id))
        )
          fail('工程归属或资源引用不正确。');
        hashes.add(w.hash);
        if (!/^[a-z][a-z0-9_]{1,47}$/.test(w.modId) || !Array.isArray(w.files))
          fail('工程元数据不正确。');
        const snapshot = {
          hash: w.hash,
          projectId: project.id,
          projectRevision: w.projectRevision,
          specHash: w.specHash,
          modId: w.modId,
          displayName: String(w.displayName).slice(0, 80),
          targetId: w.targetId,
          template: w.template,
          files: w.files,
          assetIds: w.assetIds,
          createdAt: String(w.createdAt).slice(0, 40),
          changes: [],
          imported: true,
        };
        stagedWorkspaces.records(project.id).write(w.hash, snapshot);
        stagedWorkspaces.get(project.id, w.hash);
      }
      const records = new JsonDirectory(join(stage, 'builds', 'records'));
      for (const item of input.builds) {
        const r = item.record;
        if (
          r.projectId !== old.id ||
          !hashes.has(r.snapshotHash) ||
          typeof r.log !== 'string' ||
          r.log.length > 256 * 1024
        )
          fail('构建记录归属或日志不正确。');
        const id = randomUUID();
        const record = {
          id,
          type: 'imported',
          imported: true,
          projectId: project.id,
          snapshotHash: r.snapshotHash,
          status: 'interrupted',
          createdAt: String(r.createdAt).slice(0, 40),
          finishedAt: String(r.finishedAt ?? r.createdAt).slice(0, 40),
          allowNetwork: false,
          targetId: r.targetId,
          template: r.template,
          image: null,
          log: '[外部导入记录，未在本机重新执行]\n' + r.log,
          gameTested: false,
          artifact: null,
        };
        if (item.artifact) {
          const bytes = Buffer.from(item.artifact, 'base64');
          if (
            !r.artifact ||
            bytes.length !== r.artifact.size ||
            sha256(bytes) !== r.artifact.sha256 ||
            bytes.length > LIMIT
          )
            fail('产物完整性校验失败。');
          const format = r.artifact.format ?? 'jar',
            w = stagedWorkspaces.get(project.id, r.snapshotHash);
          if (format === 'jar') {
            const m = JSON.parse(readZipEntry(bytes, 'fabric.mod.json'));
            if (m.id !== w.modId) fail('JAR 与工程不匹配。');
          } else if (format === 'mcaddon') {
            readZipEntry(readZipEntry(bytes, 'behavior_pack.mcpack'), 'manifest.json');
            readZipEntry(readZipEntry(bytes, 'resource_pack.mcpack'), 'manifest.json');
          } else fail('未知的产物格式。');
          const path = join(stage, 'builds', 'artifacts', id, 'mod.' + format);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes, { mode: 0o600 });
          record.status = 'passed';
          record.artifact = {
            name: w.modId + '-imported.' + format,
            format,
            size: bytes.length,
            sha256: sha256(bytes),
          };
        }
        records.write(id, record);
      }
      // Single-writer service commits the project last. Roll back newly moved entries on errors.
      const move = (from, to) => {
        if (existsSync(to)) fail('导入目标冲突。');
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        moved.push(to);
      };
      for (const id of assetIds)
        if (!existsSync(this.assets.records.path(id)))
          move(stagedAssets.records.path(id), this.assets.records.path(id));
      if (hashes.size)
        move(join(stage, 'workspaces', project.id), join(this.root, 'workspaces', project.id));
      for (const id of records.ids()) {
        if (existsSync(join(stage, 'builds', 'artifacts', id)))
          move(join(stage, 'builds', 'artifacts', id), join(this.root, 'builds', 'artifacts', id));
        move(records.path(id), this.builds.records.path(id));
      }
      move(stagedProjects.path(project.id), this.store.path(project.id));
      return this.store.get(project.id);
    } catch (error) {
      for (const path of moved.reverse()) rmSync(path, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      fail('备份结构无效，未导入项目。');
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
}
