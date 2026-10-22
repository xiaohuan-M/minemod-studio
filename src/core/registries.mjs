import java1201 from '../../data/registries/java-1.20.1.json' with { type: 'json' };
import java1211 from '../../data/registries/java-1.21.1.json' with { type: 'json' };
import bedrock from '../../data/registries/bedrock-1.21.60.json' with { type: 'json' };
const registries = new Map([
  ['java-1.20.1', new Set(java1201)],
  ['java-1.21.1', new Set(java1211)],
  ['bedrock-1.21.60', new Set(bedrock)],
]);
export function vanillaItems(target) {
  return [...(registries.get(target.edition + '-' + target.minecraft) ?? [])];
}
export function hasVanillaItem(target, id) {
  return registries.get(target.edition + '-' + target.minecraft)?.has(id) ?? false;
}
