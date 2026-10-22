import { sha256, safeArchivePath } from '../core/archive.mjs';
import { specHash } from '../core/mod-spec.mjs';
/** Shared deterministic envelope. Adapters only decide file contents, never storage paths. */
export function snapshotFromFiles({ spec, files, targetId, template, assetIds = [] }) {
  const entries = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => {
      safeArchivePath(path);
      const bytes = Buffer.from(data);
      return {
        path,
        size: bytes.length,
        sha256: sha256(bytes),
        encoding: 'base64',
        content: bytes.toString('base64'),
      };
    });
  return {
    hash: sha256(JSON.stringify(entries.map(({ path, size, sha256 }) => ({ path, size, sha256 })))),
    targetId,
    specHash: specHash(spec),
    modId: spec.modId,
    displayName: spec.displayName,
    template: structuredClone(template),
    files: entries,
    assetIds,
  };
}
