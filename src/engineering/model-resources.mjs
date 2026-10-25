import { validateModel } from '../core/assets.mjs';

/** Export only Minecraft fields; editor metadata and embedded PNG pixels stay in assets. */
export function javaModelResource(input, texture, { block = false, forge = false } = {}) {
  const model = validateModel(input);
  return {
    textures: { 0: texture, particle: texture },
    ...(model.display ? { display: model.display } : {}),
    ...(block ? { ambientocclusion: false } : {}),
    ...(block && forge ? { render_type: 'minecraft:cutout' } : {}),
    elements: model.elements.map((element) => ({
      ...element,
      faces: Object.fromEntries(Object.entries(element.faces).filter(([, face]) => face !== null)),
    })),
  };
}
