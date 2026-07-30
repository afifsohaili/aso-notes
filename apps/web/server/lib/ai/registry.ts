import type { ResilientFetchOptions } from './resilient-fetch'
import type { EmbeddingProvider, LLMProvider } from './types'
import { OLLAMA_BASE_URL, OllamaEmbeddingProvider, OllamaLLMProvider } from './ollama'
import { DEFAULT_EMBEDDING_MODEL, OPENROUTER_BASE_URL, OpenRouterEmbeddingProvider } from './openrouter-embedding'
import { DEFAULT_CHAT_MODEL, OpenRouterLLMProvider } from './openrouter-llm'
import { DEFAULT_RESILIENCE } from './resilient-fetch'

/**
 * AI provider registry (plan-002-system M10).
 *
 * Three call sites — agent conversation, ingestion extraction, embeddings —
 * each resolve an independent provider quad from env, following the
 * `<common>_<specific>` convention:
 *
 *   NUXT_LLM_AGENT_PROVIDER / _BASE_URL / _MODEL / _API_KEY
 *   NUXT_LLM_EXTRACTION_PROVIDER / _BASE_URL / _MODEL / _API_KEY
 *   NUXT_LLM_EMBEDDING_PROVIDER / _BASE_URL / _MODEL / _API_KEY
 *
 * Provider defaults to 'openrouter'. Base URL defaults per provider.
 * API key is required for openrouter and ignored for ollama. Model falls
 * back to the provider default (openrouter only — ollama requires an
 * explicit model). No legacy env vars are honored.
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

const KEYS: Record<'agent' | 'extraction' | 'embedding', { provider: string, baseUrl: string, model: string, apiKey: string, timeoutMs: string, maxAttempts: string, baseDelayMs: string }> = {
  agent: {
    provider: 'NUXT_LLM_AGENT_PROVIDER',
    baseUrl: 'NUXT_LLM_AGENT_BASE_URL',
    model: 'NUXT_LLM_AGENT_MODEL',
    apiKey: 'NUXT_LLM_AGENT_API_KEY',
    timeoutMs: 'NUXT_LLM_AGENT_TIMEOUT_MS',
    maxAttempts: 'NUXT_LLM_AGENT_MAX_ATTEMPTS',
    baseDelayMs: 'NUXT_LLM_AGENT_BASE_DELAY_MS',
  },
  extraction: {
    provider: 'NUXT_LLM_EXTRACTION_PROVIDER',
    baseUrl: 'NUXT_LLM_EXTRACTION_BASE_URL',
    model: 'NUXT_LLM_EXTRACTION_MODEL',
    apiKey: 'NUXT_LLM_EXTRACTION_API_KEY',
    timeoutMs: 'NUXT_LLM_EXTRACTION_TIMEOUT_MS',
    maxAttempts: 'NUXT_LLM_EXTRACTION_MAX_ATTEMPTS',
    baseDelayMs: 'NUXT_LLM_EXTRACTION_BASE_DELAY_MS',
  },
  embedding: {
    provider: 'NUXT_LLM_EMBEDDING_PROVIDER',
    baseUrl: 'NUXT_LLM_EMBEDDING_BASE_URL',
    model: 'NUXT_LLM_EMBEDDING_MODEL',
    apiKey: 'NUXT_LLM_EMBEDDING_API_KEY',
    timeoutMs: 'NUXT_LLM_EMBEDDING_TIMEOUT_MS',
    maxAttempts: 'NUXT_LLM_EMBEDDING_MAX_ATTEMPTS',
    baseDelayMs: 'NUXT_LLM_EMBEDDING_BASE_DELAY_MS',
  },
}

function providerKind(value: string | undefined): ProviderKind {
  if (value === undefined || value === '' || value === 'openrouter')
    return 'openrouter'
  if (value === 'ollama')
    return 'ollama'
  throw new Error(`Unknown LLM provider "${value}" — expected 'openrouter' or 'ollama'`)
}

function resolveApiKey(env: EnvMap, apiKeyKey: string): string {
  const apiKey = env[apiKeyKey] ?? ''
  if (!apiKey)
    throw new Error(`${apiKeyKey} is required when using the openrouter provider`)
  return apiKey
}

function resolveLLMModel(env: EnvMap, keys: { model: string }, kind: ProviderKind): string {
  const model = env[keys.model]
  if (model)
    return model
  if (kind === 'openrouter')
    return DEFAULT_CHAT_MODEL
  throw new Error(`${keys.model} is required when using the ollama provider (e.g. ${keys.model}=gemma3:4b)`)
}

function resolveResilienceOptions(
  env: EnvMap,
  keys: { timeoutMs: string, maxAttempts: string, baseDelayMs: string },
): Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>> {
  const baseDelayEnv = env[keys.baseDelayMs]
  return {
    timeoutMs: Number.parseInt(env[keys.timeoutMs] ?? String(DEFAULT_RESILIENCE.timeoutMs), 10),
    maxAttempts: Number.parseInt(env[keys.maxAttempts] ?? String(DEFAULT_RESILIENCE.maxAttempts), 10),
    baseDelayMs: baseDelayEnv !== undefined
      ? Number.parseInt(baseDelayEnv, 10)
      : DEFAULT_RESILIENCE.baseDelayMs,
  }
}

export function createLLMProvider(role: LlmRole, env: EnvMap): ResolvedLLM {
  const keys = KEYS[role]
  const kind = providerKind(env[keys.provider])
  const model = resolveLLMModel(env, keys, kind)
  const resilience = resolveResilienceOptions(env, keys)

  if (kind === 'ollama') {
    const baseUrl = env[keys.baseUrl] || OLLAMA_BASE_URL
    return { kind, model, baseUrl, provider: new OllamaLLMProvider({ model, baseUrl, ...resilience }) }
  }

  const baseUrl = env[keys.baseUrl] || OPENROUTER_BASE_URL
  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterLLMProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...resilience }),
  }
}

export function createEmbeddingProvider(env: EnvMap): ResolvedEmbedding {
  const keys = KEYS.embedding
  const kind = providerKind(env[keys.provider])
  const resilience = resolveResilienceOptions(env, keys)

  const model = env[keys.model] || (kind === 'openrouter' ? DEFAULT_EMBEDDING_MODEL : '')
  if (!model)
    throw new Error(`${keys.model} is required when using the ollama provider (e.g. ${keys.model}=nomic-embed-text)`)

  if (kind === 'ollama') {
    const baseUrl = env[keys.baseUrl] || OLLAMA_BASE_URL
    return { kind, model, baseUrl, provider: new OllamaEmbeddingProvider({ model, baseUrl, ...resilience }) }
  }

  const baseUrl = env[keys.baseUrl] || OPENROUTER_BASE_URL
  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterEmbeddingProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...resilience }),
  }
}
