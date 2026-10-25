import { join } from 'node:path';
import { JsonDirectory } from '../storage/json-directory.mjs';
import { getTarget } from '../core/targets.ts';
import { sha256 } from '../core/archive.mjs';
import { AppError } from '../core/errors.mjs';

const sources = {
  'fabric-1.20.1': {
    base: 'https://maven.fabricmc.net/docs/yarn-1.20.1+build.10/',
    items: 'net/minecraft/item/Item.html',
    blocks: 'net/minecraft/block/Block.html',
    entities: 'net/minecraft/entity/EntityType.html',
  },
  'fabric-1.21.1': {
    base: 'https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/',
    items: 'net/minecraft/item/Item.html',
    blocks: 'net/minecraft/block/Block.html',
    entities: 'net/minecraft/entity/EntityType.html',
  },
  'forge-1.20.1': {
    base: 'https://raw.githubusercontent.com/MinecraftForge/Documentation/87526dd760129b356e88f130550d646d4eb2fa31/docs/',
    items: 'items/index.md',
    blocks: 'blocks/index.md',
    entities: 'datastorage/capabilities.md',
  },
  'neoforge-1.21.1': {
    base: 'https://raw.githubusercontent.com/neoforged/Documentation/c20338406b6cbfe98b3d971baf4a89ba5fe15e82/versioned_docs/version-1.21.1/',
    items: 'items/index.md',
    blocks: 'blocks/index.md',
    entities: 'concepts/registries.md',
  },
};
export class ApiKnowledge {
  constructor(dataDir) {
    this.records = new JsonDirectory(join(dataDir, 'knowledge'));
  }
  local(targetId, spec) {
    const target = getTarget(targetId);
    if (!target) throw new AppError(422, 'TARGET_UNAVAILABLE', '没有此目标的 API 资料。');
    const config = sources[targetId];
    if (!config) return [];
    const topics = [
      'items',
      ...(spec.blocks?.length ? ['blocks'] : []),
      ...(spec.entities?.length ? ['entities'] : []),
    ];
    return topics.map((topic) => ({
      targetId,
      topic,
      url: config.base + config[topic],
      note:
        '资料必须匹配 ' +
        target.label +
        '。现有生成源码是已编译模板的 API 用法；不要混用 Yarn 与 Mojang 官方命名。',
      fetched: false,
    }));
  }
  async search(targetId, spec, { allowNetwork = false, signal } = {}) {
    return Promise.all(
      this.local(targetId, spec).map(async (source) => {
        const id = sha256(source.url);
        if (this.records.ids().includes(id)) {
          const cached = this.records.read(id);
          if (
            cached.url === source.url &&
            typeof cached.text === 'string' &&
            cached.text.length <= 10000 &&
            sha256(cached.text) === cached.sha256 &&
            Date.now() >= Date.parse(cached.fetchedAt) &&
            Date.now() - Date.parse(cached.fetchedAt) < 30 * 86400000
          )
            return { ...source, ...cached, cached: true };
        }
        if (!allowNetwork) return source;
        try {
          const response = await fetch(source.url, {
            redirect: 'error',
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
              : AbortSignal.timeout(8000),
          });
          if (!response.ok) return { ...source, unavailable: true };
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error('size');
            chunks.push(chunk);
          }
          const html = Buffer.concat(chunks).toString('utf8');
          const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
          const text = source.url.endsWith('.md')
            ? html.slice(0, 10000)
            : main
                .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/&(?:nbsp|lt|gt|amp|quot);/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 10000);
          const record = {
            url: source.url,
            text,
            fetched: true,
            fetchedAt: new Date().toISOString(),
            sha256: sha256(text),
          };
          this.records.write(id, record);
          return { ...source, ...record };
        } catch {
          signal?.throwIfAborted();
          return { ...source, unavailable: true };
        }
      }),
    );
  }
}
