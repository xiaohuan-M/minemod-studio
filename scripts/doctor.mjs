import { builderStatus } from '../src/runner/manager.mjs';
import { createOpenAIProvider } from '../src/providers/openai-compatible.mjs';
const provider = createOpenAIProvider();
const builder = await builderStatus();
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
      builder,
    },
    null,
    2,
  ),
);
