import { createOpenAIProvider } from './openai-compatible.mjs';
import { createImageProvider } from './image-compatible.mjs';

// Explicit mappings avoid accepting arbitrary environment names through HTTP.
export function providerFromProfile(profile) {
  const o = profile.options;
  if (profile.kind === 'text')
    return createOpenAIProvider({
      MINEMOD_LLM_BASE_URL: profile.baseUrl,
      MINEMOD_LLM_MODEL: profile.model,
      MINEMOD_LLM_API_KEY: profile.apiKey,
      MINEMOD_LLM_TIMEOUT_MS: String(o.timeoutMs),
      MINEMOD_LLM_MAX_TOKENS: String(o.maxTokens),
      MINEMOD_LLM_JSON_MODE: String(o.jsonMode),
      MINEMOD_LLM_TOKEN_FIELD: o.tokenField,
    });
  return createImageProvider({
    MINEMOD_IMAGE_BASE_URL: profile.baseUrl,
    MINEMOD_IMAGE_MODEL: profile.model,
    MINEMOD_IMAGE_API_KEY: profile.apiKey,
    MINEMOD_IMAGE_TIMEOUT_MS: String(o.timeoutMs),
    MINEMOD_IMAGE_RESPONSE_FORMAT: o.responseFormat,
  });
}
