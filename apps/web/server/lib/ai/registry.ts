import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { ResilientFetchOptions } from './resilient-fetch'
import type { EmbeddingProvider, LLMProvider } from './types'
import { TracedEmbeddingProvider, TracedLLMProvider } from '../observability/traced-provider'
import { OLLAMA_BASE_URL, OllamaEmbeddingProvider, OllamaLLMProvider } from './ollama'
import { OMLX_BASE_URL, OmlxEmbeddingProvider, OmlxLLMProvider } from './omlx'
import { DEFAULT_EMBEDDING_MODEL, OPENROUTER_BASE_URL, OpenRouterEmbeddingProvider } from './openrouter-embedding'
import { DEFAULT_CHAT_MODEL, OpenRouterLLMProvider } from './openrouter-llm'
import { DEFAULT_RESILIENCE } from './resilient-fetch'

export { OLLAMA_BASE_URL } from './ollama'
export { OMLX_BASE_URL } from './omlx'
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
 * API key is required for openrouter and ignored for ollama and omlx.
 * Model falls back to the provider default (openrouter only — ollama and
 * omlx require an explicit model). omlx defaults to the local oMLX server
 * at http://localhost:8000/v1. No legacy env vars are honored.
 *
 * Phase 3 adds workspace_settings overrides: caller supplies a settings
 * object (provider, model, base_url) and it wins over env, which wins over
 * code defaults. Use `createLLMProvider` / `createEmbeddingProvider` for
 * env-only resolution, or `resolveLLMProvider` / `resolveEmbeddingProvider`
 * when workspace settings are available.
 */

export type ProviderKind = 'openrouter' | 'ollama' | 'omlx'
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
  /** Injectable for tests — no live API calls in the test suite. */
  fetchFn?: typeof fetch
  /** Injectable for tests — no real sleeps in the test suite. */
  sleepFn?: (ms: number) => Promise<void>
}

export interface TraceResolveOptions {
  db: Kysely<Database>
}

function providerKind(value: string | undefined): ProviderKind {
  if (value === undefined || value === '' || value === 'openrouter')
    return 'openrouter'
  if (value === 'ollama')
    return 'ollama'
  if (value === 'omlx')
    return 'omlx'
  throw new Error(`Unknown LLM provider "${value}" — expected 'openrouter', 'ollama' or 'omlx'`)
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
  throw new Error(`${KEYS[role].model} is required when using the ${kind} provider`)
}

function resolveEmbeddingModelDefault(kind: ProviderKind): string {
  if (kind === 'openrouter')
    return DEFAULT_EMBEDDING_MODEL
  throw new Error(`${KEYS.embedding.model} is required when using the ${kind} provider`)
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

export function resolveLLMProvider(role: LlmRole, env: EnvMap, settings: ResolvedProviderSettings = {}, options?: ResolveOptions, trace?: TraceResolveOptions): ResolvedLLM {
  const keys = KEYS[role]
  const kind = providerKind(settings.provider || env[keys.provider])
  const model = settings.model || env[keys.model] || resolveLLMModelDefault(kind, role)
  const baseUrl = settings.base_url || env[keys.baseUrl] || (kind === 'ollama' ? OLLAMA_BASE_URL : kind === 'omlx' ? OMLX_BASE_URL : OPENROUTER_BASE_URL)
  const resilience = resolveResilienceOptions(env, keys, options)
  const providerOptions = { ...resilience, fetchFn: options?.fetchFn, sleepFn: options?.sleepFn }

  let provider: LLMProvider
  if (kind === 'ollama') {
    provider = new OllamaLLMProvider({ model, baseUrl, ...providerOptions })
  }
  else if (kind === 'omlx') {
    provider = new OmlxLLMProvider({ model, baseUrl, ...providerOptions })
  }
  else {
    provider = new OpenRouterLLMProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...providerOptions })
  }

  if (trace) {
    provider = new TracedLLMProvider(provider, { db: trace.db, provider: kind, model, llmUseCase: role })
  }

  return { kind, model, baseUrl, provider }
}

export function createLLMProvider(role: LlmRole, env: EnvMap): ResolvedLLM {
  return resolveLLMProvider(role, env)
}

export function resolveEmbeddingProvider(env: EnvMap, settings: ResolvedProviderSettings = {}, options?: ResolveOptions, trace?: TraceResolveOptions): ResolvedEmbedding {
  const keys = KEYS.embedding
  const kind = providerKind(settings.provider || env[keys.provider])
  const model = settings.model || env[keys.model] || resolveEmbeddingModelDefault(kind)
  const baseUrl = settings.base_url || env[keys.baseUrl] || (kind === 'ollama' ? OLLAMA_BASE_URL : kind === 'omlx' ? OMLX_BASE_URL : OPENROUTER_BASE_URL)
  const resilience = resolveResilienceOptions(env, keys, options)
  const providerOptions = { ...resilience, fetchFn: options?.fetchFn, sleepFn: options?.sleepFn }

  let provider: EmbeddingProvider
  if (kind === 'ollama') {
    provider = new OllamaEmbeddingProvider({ model, baseUrl, ...providerOptions })
  }
  else if (kind === 'omlx') {
    provider = new OmlxEmbeddingProvider({ model, baseUrl, ...providerOptions })
  }
  else {
    provider = new OpenRouterEmbeddingProvider({ apiKey: resolveApiKey(env, keys.apiKey), model, baseUrl, ...providerOptions })
  }

  if (trace) {
    provider = new TracedEmbeddingProvider(provider, { db: trace.db, provider: kind, model, llmUseCase: 'embedding' })
  }

  return { kind, model, baseUrl, provider }
}

export function createEmbeddingProvider(env: EnvMap): ResolvedEmbedding {
  return resolveEmbeddingProvider(env)
}
