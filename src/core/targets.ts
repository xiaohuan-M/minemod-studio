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
];
const descriptors: readonly TargetDescriptor[] = [
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
