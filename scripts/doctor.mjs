import { TARGETS } from '../src/core/targets.ts';
import { createImageProvider } from '../src/providers/image-compatible.mjs';
import { builderStatus } from '../src/runner/manager.mjs';
import { createOpenAIProvider } from '../src/providers/openai-compatible.mjs';
const provider = createOpenAIProvider();
const builders = await Promise.all(
  TARGETS.filter((t) => t.target.edition === 'java').map(async (t) => ({
    targetId: t.id,
    ...(await builderStatus(t.id)),
  })),
);
const images = createImageProvider();
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      llm: {
        configured: provider.info.configured,
        model: provider.info.model ?? null,
        configurationError: provider.info.configurationError ?? null,
      },
      builders,
      images: { configured: images.info.configured, model: images.info.model ?? null },
    },
    null,
    2,
  ),
);
