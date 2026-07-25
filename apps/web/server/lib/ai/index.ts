import type { EmbeddingProvider, LLMProvider } from './types'
import process from 'node:process'
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  OPENROUTER_BASE_URL,
  OpenRouterEmbeddingProvider,
} from './openrouter-embedding'
import { DEFAULT_CHAT_MODEL, OpenRouterLLMProvider } from './openrouter-llm'

export {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  OPENROUTER_BASE_URL,
  OpenRouterEmbeddingProvider,
  OpenRouterLLMProvider,
}
export * from './types'

export interface AiEnv {
  openrouterApiKey?: string
  openrouterChatModel?: string
  openrouterEmbeddingModel?: string
}

function resolveApiKey(env: AiEnv): string {
  const apiKey = env.openrouterApiKey ?? process.env.NUXT_OPENROUTER_API_KEY ?? ''
  if (!apiKey)
    throw new Error('NUXT_OPENROUTER_API_KEY is required to create an AI provider')
  return apiKey
}

/** Build the app's embedding provider from runtime config / environment. */
export function createEmbeddingProviderFromEnv(env: AiEnv = {}): EmbeddingProvider {
  return new OpenRouterEmbeddingProvider({
    apiKey: resolveApiKey(env),
    // Empty strings (nuxt runtimeConfig defaults) mean "unset".
    model: env.openrouterEmbeddingModel || process.env.NUXT_OPENROUTER_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  })
}

/** Build the app's LLM (chat/extraction) provider from runtime config / environment. */
export function createLLMProviderFromEnv(env: AiEnv = {}): LLMProvider {
  return new OpenRouterLLMProvider({
    apiKey: resolveApiKey(env),
    // Empty strings (nuxt runtimeConfig defaults) mean "unset".
    model: env.openrouterChatModel || process.env.NUXT_OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL,
  })
}
