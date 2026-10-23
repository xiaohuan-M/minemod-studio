import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { JsonDirectory } from './json-directory.mjs';
import { AppError } from '../core/errors.mjs';
import { normalizeProfile, profileKind, publicProfile } from '../core/provider-profile.mjs';

// A single private record keeps selection and secrets in the same atomic commit.
// This directory is deliberately outside every project/asset backup format.
const RECORD = '7211163e-9cda-47e7-97f5-1afcf331183e';
const empty = () => ({
  schemaVersion: 1,
  revision: 0,
  active: { text: null, image: null },
  profiles: [],
});
export class ProviderProfileStore {
  constructor(dataDir, { readOnly = false } = {}) {
    this.readOnly = readOnly;
    const path = join(dataDir, 'settings');
    this.disk = readOnly && !existsSync(path) ? null : new JsonDirectory(path);
    this.state = this.read();
  }
  read() {
    if (!this.disk) return empty();
    let record;
    try {
      record = this.disk.read(RECORD);
    } catch (error) {
      if (error.code === 'RECORD_NOT_FOUND') return empty();
      throw error;
    }
    try {
      if (
        record.schemaVersion !== 1 ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 0 ||
        !Array.isArray(record.profiles) ||
        record.profiles.length > 20 ||
        !record.active ||
        Object.keys(record.active).sort().join(',') !== 'image,text'
      )
        throw Error();
      const seen = new Set();
      for (const p of record.profiles) {
        this.disk.path(p.id);
        if (seen.has(p.id) || !Number.isFinite(Date.parse(p.updatedAt))) throw Error();
        seen.add(p.id);
        const { id, updatedAt, ...input } = p;
        normalizeProfile(input);
      }
      for (const kind of ['text', 'image'])
        if (
          record.active[kind] !== null &&
          !record.profiles.some((p) => p.id === record.active[kind] && p.kind === kind)
        )
          throw Error();
      return record;
    } catch {
      throw new AppError(
        500,
        'PROVIDER_SETTINGS_CORRUPT',
        '模型设置记录损坏，已保留原文件，请从私人备份恢复。',
      );
    }
  }
  summary() {
    return {
      revision: this.state.revision,
      active: { ...this.state.active },
      profiles: this.state.profiles.map(publicProfile),
      limit: 20,
    };
  }
  selected(kind) {
    return this.state.profiles.find((p) => p.id === this.state.active[profileKind(kind)]) ?? null;
  }
  assertRevision(revision) {
    if (revision !== this.state.revision)
      throw new AppError(409, 'SETTINGS_CHANGED', '模型设置已被其他页面修改，请刷新设置后重试。');
  }
  commit(state) {
    if (this.readOnly) throw new AppError(409, 'READ_ONLY_SETTINGS', '诊断模式不能修改服务配置。');
    state.revision++;
    this.disk.write(RECORD, state);
    this.state = state;
    return this.summary();
  }
  save(input, revision, id = null) {
    this.assertRevision(revision);
    const previous = id === null ? null : this.state.profiles.find((p) => p.id === id);
    if (id !== null && !previous) throw new AppError(404, 'PROFILE_NOT_FOUND', '服务配置不存在。');
    if (!previous && this.state.profiles.length >= 20)
      throw new AppError(422, 'PROFILE_LIMIT', '最多保存 20 个服务配置。');
    const profile = {
      id: previous?.id ?? randomUUID(),
      ...normalizeProfile(input, previous),
      updatedAt: new Date().toISOString(),
    };
    const state = structuredClone(this.state);
    if (previous) state.profiles[state.profiles.findIndex((p) => p.id === id)] = profile;
    else state.profiles.push(profile);
    return this.commit(state);
  }
  activate(kind, id, revision) {
    this.assertRevision(revision);
    profileKind(kind);
    if (id !== null && !this.state.profiles.some((p) => p.id === id && p.kind === kind))
      throw new AppError(422, 'PROFILE_NOT_FOUND', '所选服务不存在或类型不匹配。');
    const state = structuredClone(this.state);
    state.active[kind] = id;
    return this.commit(state);
  }
  remove(id, revision) {
    this.assertRevision(revision);
    if (!this.state.profiles.some((p) => p.id === id))
      throw new AppError(404, 'PROFILE_NOT_FOUND', '服务配置不存在。');
    if (Object.values(this.state.active).includes(id))
      throw new AppError(
        409,
        'PROFILE_IN_USE',
        '请先切换到其他配置或环境变量，再删除正在使用的配置。',
      );
    const state = structuredClone(this.state);
    state.profiles = state.profiles.filter((p) => p.id !== id);
    return this.commit(state);
  }
}
