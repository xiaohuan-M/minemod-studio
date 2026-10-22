import type { GameTarget, TargetDescriptor } from '../contracts/ports.ts';

const features = [
  'items',
  'food',
  'tools',
  'blocks',
  'lightning_wand',
  'recipes',
  'textures',
  'static_models',
  'vanilla_entity_archetypes',
];
const descriptors: readonly TargetDescriptor[] = [
  {
    id: 'bedrock-1.21.60',
    label: 'Bedrock · 1.21.60 · 附加包',
    target: { edition: 'bedrock', loader: 'bedrock', minecraft: '1.21.60', java: 0 },
    artifact: 'mcaddon',
    validation: 'package-checked',
    enabled: true,
    features: ['items', 'food', 'blocks', 'recipes', 'textures'],
  },
  {
    id: 'fabric-1.20.1',
    label: 'Fabric · 1.20.1 · Java 17',
    target: { edition: 'java', loader: 'fabric', minecraft: '1.20.1', java: 17 },
    artifact: 'jar',
    validation: 'compiled',
    enabled: true,
    features,
  },
  {
    id: 'fabric-1.21.1',
    label: 'Fabric · 1.21.1 · Java 21',
    target: { edition: 'java', loader: 'fabric', minecraft: '1.21.1', java: 21 },
    artifact: 'jar',
    validation: 'compiled',
    enabled: true,
    features,
  },
];
export const TARGETS: readonly TargetDescriptor[] = Object.freeze(
  descriptors.map((d) =>
    Object.freeze({
      ...d,
      target: Object.freeze(d.target),
      features: Object.freeze([...d.features]),
    }),
  ),
);
export const DEFAULT_TARGET_ID = 'fabric-1.21.1';
export function getTarget(id: string): TargetDescriptor | undefined {
  return TARGETS.find((target) => target.id === id);
}
export function identifyTarget(value: GameTarget): TargetDescriptor | undefined {
  return TARGETS.find(
    ({ target }) =>
      target.edition === value.edition &&
      target.loader === value.loader &&
      target.minecraft === value.minecraft &&
      target.java === value.java,
  );
}
