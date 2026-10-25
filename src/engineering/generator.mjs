import { validateModSpec } from '../core/mod-spec.mjs';
import { AppError } from '../core/errors.mjs';
import { identifyTarget } from '../core/targets.ts';
import { withGameTests } from './game-tests.mjs';
import { generateForge } from './adapters/forge.mjs';
import forge from '../../templates/forge-1.20.1/manifest.json' with { type: 'json' };
import neoforge from '../../templates/neoforge-1.21.1/manifest.json' with { type: 'json' };
import { generateBedrock } from './adapters/bedrock.mjs';
import { generateFabric } from './adapters/fabric.mjs';
import fabric1211 from '../../templates/fabric-1.21.1/manifest.json' with { type: 'json' };
import fabric1201 from '../../templates/fabric-1.20.1/manifest.json' with { type: 'json' };
export const TEMPLATE = Object.freeze(fabric1211);
export function builderTemplate(targetId = 'fabric-1.21.1') {
  const template = {
    'fabric-1.21.1': fabric1211,
    'fabric-1.20.1': fabric1201,
    'forge-1.20.1': forge,
    'neoforge-1.21.1': neoforge,
  }[targetId];
  if (!template) throw new AppError(422, 'TARGET_UNAVAILABLE', '此目标不使用 Java 构建器。');
  return structuredClone(template);
}
const adapters = new Map([
  ['forge-1.20.1', (s) => generateForge(s.input, s.assets, forge)],
  ['neoforge-1.21.1', (s) => generateForge(s.input, s.assets, neoforge)],
  ['bedrock-1.21.60', (spec) => generateBedrock(spec.input, spec.assets)],
  ['fabric-1.21.1', (spec) => generateFabric(spec.input, spec.assets, fabric1211)],
  ['fabric-1.20.1', (spec) => generateFabric(spec.input, spec.assets, fabric1201)],
]);
export function generateWorkspace(input, assets = []) {
  const spec = validateModSpec(input),
    target = identifyTarget(spec.target),
    generate = adapters.get(target?.id);
  if (!target?.enabled || !generate)
    throw new AppError(422, 'TARGET_UNAVAILABLE', '这个目标尚没有可用的生成适配器。');
  return withGameTests(spec, generate({ input: spec, assets }));
}
export function workspaceFiles(snapshot) {
  return Object.fromEntries(
    snapshot.files.map((file) => [file.path, Buffer.from(file.content, 'base64')]),
  );
}
export function diffWorkspaces(previous, next) {
  const before = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  const after = new Map(next.files.map((file) => [file.path, file]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((path) => before.get(path)?.sha256 !== after.get(path)?.sha256)
    .map((path) => ({
      path,
      change: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'modified',
      before: before.get(path)?.sha256 ?? null,
      after: after.get(path)?.sha256 ?? null,
    }));
}
