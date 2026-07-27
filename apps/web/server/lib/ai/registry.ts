import type { EmbeddingProvider, LLMProvider } from './types'
import { OLLAMA_BASE_URL, OllamaEmbeddingProvider, OllamaLLMProvider } from './ollama'
import { DEFAULT_EMBEDDING_MODEL, OPENROUTER_BASE_URL, OpenRouterEmbeddingProvider } from './openrouter-embedding'
import { DEFAULT_CHAT_MODEL, OpenRouterLLMProvider } from './openrouter-llm'

/**
 * AI provider registry (plan-002-system M10).
 *
 * Three call sites — agent conversation, ingestion extraction, embeddings —
 * each resolve an independent provider + model from env, following the
 * `<common>_<specific>` convention:
 *
 *   NUXT_LLM_AGENT_PROVIDER / _BASE_URL / _MODEL
 *   NUXT_LLM_EXTRACTION_PROVIDER / _BASE_URL / _MODEL
 *   NUXT_LLM_EMBEDDING_PROVIDER / _BASE_URL / _MODEL
 *
 * Provider defaults to 'openrouter'. Model falls back to the legacy
 * NUXT_OPENROUTER_CHAT_MODEL / NUXT_OPENROUTER_EMBEDDING_MODEL, then to the
 * provider default (openrouter only — ollama requires an explicit model).
 */

export type ProviderKind = 'openrouter' | 'ollama'
export type LlmRole = 'agent' | 'extraction'

export type EnvMap = Record<string, string | undefined>

export interface ResolvedLLM {
  kind: ProviderKind
  model: string
  baseUrl: string
  provider: LLMProvider
}

export interface ResolvedEmbedding {
  kind: ProviderKind
  model: string
  baseUrl: string
  provider: EmbeddingProvider
}

function providerKind(value: string | undefined): ProviderKind {
  if (value === undefined || value === '' || value === 'openrouter')
    return 'openrouter'
  if (value === 'ollama')
    return 'ollama'
  throw new Error(`Unknown LLM provider "${value}" — expected 'openrouter' or 'ollama'`)
}

function resolveApiKey(env: EnvMap): string {
  const apiKey = env.NUXT_OPENROUTER_API_KEY ?? ''
  if (!apiKey)
    throw new Error('NUXT_OPENROUTER_API_KEY is required to create an AI provider')
  return apiKey
}

function resolveLLMModel(env: EnvMap, role: LlmRole, kind: ProviderKind): string {
  const perUse = role === 'agent' ? env.NUXT_LLM_AGENT_MODEL : env.NUXT_LLM_EXTRACTION_MODEL
  const model = perUse || env.NUXT_OPENROUTER_CHAT_MODEL
  if (model)
    return model
  if (kind === 'openrouter')
    return DEFAULT_CHAT_MODEL
  const key = role === 'agent' ? 'NUXT_LLM_AGENT_MODEL' : 'NUXT_LLM_EXTRACTION_MODEL'
  throw new Error(`${key} is required when using the ollama provider (e.g. ${key}=gemma3:4b)`)
}

export function createLLMProvider(role: LlmRole, env: EnvMap): ResolvedLLM {
  const providerKey = role === 'agent' ? 'NUXT_LLM_AGENT_PROVIDER' : 'NUXT_LLM_EXTRACTION_PROVIDER'
  const baseUrlKey = role === 'agent' ? 'NUXT_LLM_AGENT_BASE_URL' : 'NUXT_LLM_EXTRACTION_BASE_URL'

  const kind = providerKind(env[providerKey])
  const model = resolveLLMModel(env, role, kind)

  if (kind === 'ollama') {
    const baseUrl = env[baseUrlKey] || OLLAMA_BASE_URL
    return { kind, model, baseUrl, provider: new OllamaLLMProvider({ model, baseUrl }) }
  }

  const baseUrl = env[baseUrlKey] || OPENROUTER_BASE_URL
  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterLLMProvider({ apiKey: resolveApiKey(env), model, baseUrl }),
  }
}

export function createEmbeddingProvider(env: EnvMap): ResolvedEmbedding {
  const kind = providerKind(env.NUXT_LLM_EMBEDDING_PROVIDER)
  const perUse = env.NUXT_LLM_EMBEDDING_MODEL || env.NUXT_OPENROUTER_EMBEDDING_MODEL
  const model = perUse || (kind === 'openrouter' ? DEFAULT_EMBEDDING_MODEL : '')
  if (!model)
    throw new Error('NUXT_LLM_EMBEDDING_MODEL is required when using the ollama provider (e.g. NUXT_LLM_EMBEDDING_MODEL=nomic-embed-text)')

  if (kind === 'ollama') {
    const baseUrl = env.NUXT_LLM_EMBEDDING_BASE_URL || OLLAMA_BASE_URL
    return { kind, model, baseUrl, provider: new OllamaEmbeddingProvider({ model, baseUrl }) }
  }

  const baseUrl = env.NUXT_LLM_EMBEDDING_BASE_URL || OPENROUTER_BASE_URL
  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterEmbeddingProvider({ apiKey: resolveApiKey(env), model, baseUrl }),
  }
}
