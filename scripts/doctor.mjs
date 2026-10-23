import { TARGETS } from '../src/core/targets.ts';
import { resolve } from 'node:path';
import { ProviderProfileStore } from '../src/storage/provider-profile-store.mjs';
import { providerFromProfile } from '../src/providers/profile-runtime.mjs';
import { createImageProvider } from '../src/providers/image-compatible.mjs';
import { builderStatus } from '../src/runner/manager.mjs';
import { createOpenAIProvider } from '../src/providers/openai-compatible.mjs';
const profiles = new ProviderProfileStore(resolve(process.env.MINEMOD_DATA_DIR ?? '.minemod'), {
  readOnly: true,
});
const textProfile = profiles.selected('text'),
  imageProfile = profiles.selected('image');
const provider = textProfile ? providerFromProfile(textProfile) : createOpenAIProvider();
const builders = await Promise.all(
  TARGETS.filter((t) => t.target.edition === 'java').map(async (t) => ({
    targetId: t.id,
    ...(await builderStatus(t.id)),
  })),
);
const images = imageProfile ? providerFromProfile(imageProfile) : createImageProvider();
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
