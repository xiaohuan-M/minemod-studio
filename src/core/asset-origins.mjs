import { AppError } from './errors.mjs';
const fail = () => {
  throw new AppError(422, 'INVALID_ASSET_ORIGINS', '素材来源摘要格式无效或超过 64 项。');
};

/** Attribution summaries only. Foreign IDs never grant access or execution. */
export function normalizeOrigins(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 64) fail();
  const seen = new Map();
  for (const origin of input) {
    if (
      !origin ||
      Object.keys(origin).some(
        (key) => !['id', 'name', 'kind', 'sha256', 'source', 'license'].includes(key),
      ) ||
      !/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(origin.id ?? '') ||
      !/^[a-f0-9]{64}$/.test(origin.sha256 ?? '') ||
      !['texture', 'model', 'animated_model', 'image'].includes(origin.kind)
    )
      fail();
    for (const [field, max] of [
      ['name', 80],
      ['source', 200],
      ['license', 200],
    ])
      if (typeof origin[field] !== 'string' || !origin[field].trim() || origin[field].length > max)
        fail();
    const normalized = {
      id: origin.id,
      name: origin.name,
      kind: origin.kind,
      sha256: origin.sha256,
      source: origin.source,
      license: origin.license,
    };
    const prior = seen.get(origin.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) fail();
    seen.set(origin.id, normalized);
  }
  return seen.size ? [...seen.values()] : undefined;
}

export function assetOrigins(...inputs) {
  const entries = inputs
    .filter(Boolean)
    .flatMap((asset) =>
      asset.derivedFrom?.some((origin) => origin.kind === asset.kind)
        ? asset.derivedFrom
        : [
            Object.fromEntries(
              ['id', 'name', 'kind', 'sha256', 'source', 'license'].map((key) => [key, asset[key]]),
            ),
            ...(asset.derivedFrom ?? []),
          ],
    );
  return normalizeOrigins(entries);
}
