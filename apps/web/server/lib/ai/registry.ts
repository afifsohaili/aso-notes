import type { ResilientFetchOptions } from './resilient-fetch'
import type { EmbeddingProvider, LLMProvider } from './types'
import { OLLAMA_BASE_URL, OllamaEmbeddingProvider, OllamaLLMProvider } from './ollama'
import { DEFAULT_EMBEDDING_MODEL, OPENROUTER_BASE_URL, OpenRouterEmbeddingProvider } from './openrouter-embedding'
import { DEFAULT_CHAT_MODEL, OpenRouterLLMProvider } from './openrouter-llm'
import { DEFAULT_RESILIENCE } from './resilient-fetch'

export { OLLAMA_BASE_URL } from './ollama'
export { DEFAULT_EMBEDDING_MODEL } from './openrouter-embedding'
export { DEFAULT_CHAT_MODEL, OPENROUTER_BASE_URL } from './openrouter-llm'

/**
 * AI provider registry (plan-002-system M10 + plan-007 Phase 3).
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
 *
 * Phase 3 adds workspace_settings overrides: caller supplies a settings
 * object (provider, model, base_url) and it wins over env, which wins over
 * code defaults. Use `createLLMProvider` / `createEmbeddingProvider` for
 * env-only resolution, or `resolveLLMProvider` / `resolveEmbeddingProvider`
 * when workspace settings are available.
 */

export type ProviderKind = 'openrouter' | 'ollama'
export type LlmRole = 'agent' | 'extraction' | 'consolidation'

export type EnvMap = Record<string, string | undefined>

/** Settings overrides coming from workspace_settings (Phase 3). */
export interface ResolvedProviderSettings {
  provider?: string
  model?: string
  base_url?: string
}

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

export const KEYS: Record<'agent' | 'extraction' | 'embedding' | 'consolidation', { provider: string, baseUrl: string, model: string, apiKey: string, timeoutMs: string, maxAttempts: string, baseDelayMs: string }> = {
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
  consolidation: {
    provider: 'NUXT_LLM_CONSOLIDATION_PROVIDER',
    baseUrl: 'NUXT_LLM_CONSOLIDATION_BASE_URL',
    model: 'NUXT_LLM_CONSOLIDATION_MODEL',
    apiKey: 'NUXT_LLM_CONSOLIDATION_API_KEY',
    timeoutMs: 'NUXT_LLM_CONSOLIDATION_TIMEOUT_MS',
    maxAttempts: 'NUXT_LLM_CONSOLIDATION_MAX_ATTEMPTS',
    baseDelayMs: 'NUXT_LLM_CONSOLIDATION_BASE_DELAY_MS',
  },
}

export interface ResolveOptions {
  timeoutMs?: number
  maxAttempts?: number
}

function providerKind(value: string | undefined): ProviderKind {
  if (value === undefined || value === '' || value === 'openrouter')
    return 'openrouter'
  if (value === 'ollama')
    return 'ollama'
  throw new Error(`Unknown LLM provider "${value}" — expected 'openrouter' or 'ollama'`)
}

export function resolveApiKey(env: EnvMap, apiKeyKey: string): string {
  const apiKey = env[apiKeyKey] ?? ''
  if (!apiKey)
    throw new Error(`${apiKeyKey} is required when using the openrouter provider`)
  return apiKey
}

function resolveLLMModelDefault(kind: ProviderKind, role: LlmRole): string {
  if (kind === 'openrouter')
    return DEFAULT_CHAT_MODEL
  throw new Error(`${KEYS[role].model} is required when using the ollama provider`)
}

function resolveEmbeddingModelDefault(kind: ProviderKind): string {
  if (kind === 'openrouter')
    return DEFAULT_EMBEDDING_MODEL
  throw new Error(`${KEYS.embedding.model} is required when using the ollama provider`)
}

function resolveResilienceOptions(
  env: EnvMap,
  keys: { timeoutMs: string, maxAttempts: string, baseDelayMs: string },
  options?: ResolveOptions,
): Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>> {
  const baseDelayEnv = env[keys.baseDelayMs]
  return {
    timeoutMs: options?.timeoutMs ?? Number.parseInt(env[keys.timeoutMs] ?? String(DEFAULT_RESILIENCE.timeoutMs), 10),
    maxAttempts: options?.maxAttempts ?? Number.parseInt(env[keys.maxAttempts] ?? String(DEFAULT_RESILIENCE.maxAttempts), 10),
    baseDelayMs: baseDelayEnv !== undefined
      ? Number.parseInt(baseDelayEnv, 10)
      : DEFAULT_RESILIENCE.baseDelayMs,
  }
}

export function resolveLLMProvider(role: LlmRole, env: EnvMap, settings: ResolvedProviderSettings = {}, options?: ResolveOptions): ResolvedLLM {
  const keys = KEYS[role]
  const kind = providerKind(settings.provider || env[keys.provider])
  const model = settings.model || env[keys.model] || resolveLLMModelDefault(kind, role)
  const baseUrl = settings.base_url || env[keys.baseUrl] || (kind === 'ollama' ? OLLAMA_BASE_URL : OPENROUTER_BASE_URL)
  const resilience = resolveResilienceOptions(env, keys, options)

  if (kind === 'ollama') {
    return { kind, model, baseUrl, provider: new OllamaLLMProvider({ model, baseUrl, ...resilience }) }
  }

  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterLLMProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...resilience }),
  }
}

export function createLLMProvider(role: LlmRole, env: EnvMap): ResolvedLLM {
  return resolveLLMProvider(role, env)
}

export function resolveEmbeddingProvider(env: EnvMap, settings: ResolvedProviderSettings = {}, options?: ResolveOptions): ResolvedEmbedding {
  const keys = KEYS.embedding
  const kind = providerKind(settings.provider || env[keys.provider])
  const model = settings.model || env[keys.model] || resolveEmbeddingModelDefault(kind)
  const baseUrl = settings.base_url || env[keys.baseUrl] || (kind === 'ollama' ? OLLAMA_BASE_URL : OPENROUTER_BASE_URL)
  const resilience = resolveResilienceOptions(env, keys, options)

  if (kind === 'ollama') {
    return { kind, model, baseUrl, provider: new OllamaEmbeddingProvider({ model, baseUrl, ...resilience }) }
  }

  return {
    kind,
    model,
    baseUrl,
    provider: new OpenRouterEmbeddingProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...resilience }),
  }
}

export function createEmbeddingProvider(env: EnvMap): ResolvedEmbedding {
  return resolveEmbeddingProvider(env)
}
