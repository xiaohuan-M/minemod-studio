import { validateModel, validateTexture } from './assets.mjs';
import { validateAnimation } from './animation.mjs';
import { AppError } from './errors.mjs';
export function assetData(kind, input) {
  if (kind === 'texture') {
    if (input?.runs) {
      if (
        ![16, 32, 64].includes(input.width) ||
        input.height !== input.width ||
        !Array.isArray(input.palette) ||
        !input.palette.length ||
        input.palette.length > 64 ||
        !Array.isArray(input.runs) ||
        input.runs.length > 4096
      )
        throw new AppError(422, 'INVALID_ASSET', '像素调色板或游程数据无效。');
      const pixels = [];
      for (const run of input.runs) {
        if (
          !Array.isArray(run) ||
          run.length !== 2 ||
          !Number.isInteger(run[0]) ||
          run[0] < 0 ||
          run[0] >= input.palette.length ||
          !Number.isInteger(run[1]) ||
          run[1] < 1 ||
          pixels.length + run[1] > input.width * input.height
        )
          throw new AppError(422, 'INVALID_ASSET', '像素游程超出边界。');
        pixels.push(...Array(run[1]).fill(input.palette[run[0]]));
      }
      return validateTexture({ width: input.width, height: input.height, pixels });
    }
    return validateTexture(input);
  }
  if (kind === 'model') return validateModel(input);
  if (kind === 'animated_model') return validateAnimation(input);
  throw new AppError(422, 'INVALID_ASSET', '请选择贴图、模型或动画模型。');
}
export function assetGeneration(input) {
  if (
    !['texture', 'model', 'animated_model'].includes(input.kind) ||
    typeof input.prompt !== 'string' ||
    !input.prompt.trim() ||
    input.prompt.length > 2000
  )
    throw new AppError(422, 'INVALID_INPUT', '素材类型无效或描述超过 2000 字。');
  const conversation = input.conversation ?? [];
  if (
    !Array.isArray(conversation) ||
    conversation.length > 12 ||
    conversation.some((v) => typeof v !== 'string' || v.length > 2000)
  )
    throw new AppError(422, 'INVALID_INPUT', '素材上下文最多 12 条，每条 2000 字。');
  return {
    kind: input.kind,
    prompt: input.prompt.trim(),
    conversation,
    ...(input.currentData ? { currentData: assetData(input.kind, input.currentData) } : {}),
  };
}
