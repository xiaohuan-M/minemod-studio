// Each entry is an independent roll. Missing loot preserves the prior target defaults.
export function lootEntries(spec, owner, kind) {
  return (
    owner.loot ??
    (kind === 'block' ? [{ item: spec.modId + ':' + owner.id, min: 1, max: 1, chance: 1 }] : [])
  );
}
export function javaLoot(spec, owner, kind) {
  return {
    type: 'minecraft:' + kind,
    pools: lootEntries(spec, owner, kind).map((drop) => ({
      rolls: 1,
      entries: [
        {
          type: 'minecraft:item',
          name: drop.item,
          functions: [
            {
              function: 'minecraft:set_count',
              count:
                drop.min === drop.max
                  ? drop.min
                  : { type: 'minecraft:uniform', min: drop.min, max: drop.max },
            },
          ],
        },
      ],
      conditions: [
        ...(kind === 'block' ? [{ condition: 'minecraft:survives_explosion' }] : []),
        ...(drop.chance < 1 ? [{ condition: 'minecraft:random_chance', chance: drop.chance }] : []),
        ...(drop.playerOnly ? [{ condition: 'minecraft:killed_by_player' }] : []),
      ],
    })),
  };
}
export function bedrockLoot(spec, owner, kind) {
  return {
    pools: lootEntries(spec, owner, kind).map((drop) => ({
      rolls: 1,
      entries: [
        {
          type: 'item',
          name: drop.item,
          weight: 1,
          functions: [
            {
              function: 'set_count',
              count: drop.min === drop.max ? drop.min : { min: drop.min, max: drop.max },
            },
          ],
        },
      ],
      conditions: [
        ...(drop.chance < 1 ? [{ condition: 'random_chance', chance: drop.chance }] : []),
        ...(drop.playerOnly ? [{ condition: 'killed_by_player' }] : []),
      ],
    })),
  };
}
