import type { Json } from '@monorepo/shared'
import type { EnvMap, ResolvedProviderSettings } from './ai/registry'
import type { PipelineDb } from './pipeline/types'
import process from 'node:process'
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  KEYS,
  OLLAMA_BASE_URL,
  OPENROUTER_BASE_URL,
} from './ai/registry'
import { defaultVocabularyStrategy, getVocabularyStrategy } from './pipeline/vocabulary'

/**
 * Known workspace-scoped setting keys. These are the only settings exposed
 * by the Settings UI; unknown keys are rejected at write time and ignored
 * at read time.
 */
export const KNOWN_SETTING_KEYS = [
  'extraction.vocabulary_strategy',
  'extraction.blind_merge_threshold',
  'llm.agent.provider',
  'llm.agent.model',
  'llm.agent.base_url',
  'llm.extraction.provider',
  'llm.extraction.model',
  'llm.extraction.base_url',
  'llm.embedding.provider',
  'llm.embedding.model',
  'llm.embedding.base_url',
  'onboarding.completed_at',
] as const

export type KnownSettingKey = typeof KNOWN_SETTING_KEYS[number]

export const DEFAULT_LLM_PROVIDER = 'openrouter'

export interface ResolvedSetting {
  value: Json
  source: 'workspace' | 'default'
}

export type ResolvedSettings = Record<KnownSettingKey, ResolvedSetting>

/**
 * Read a workspace-scoped setting from workspace_settings, returning the
 * fallback value when no row exists.
 */
export async function getWorkspaceSetting<T>(
  db: PipelineDb,
  workspaceId: string,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await db
    .selectFrom('workspace_settings')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', key)
    .executeTakeFirst()

  if (!row)
    return fallback

  return row.value as T
}

function strategyIdFromSetting(value: unknown): string | null {
  if (typeof value === 'string')
    return value
  if (isRecord(value) && typeof value.strategy === 'string')
    return value.strategy
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve the active vocabulary strategy for a workspace.
 * Reads `extraction.vocabulary_strategy` from workspace_settings;
 * falls back to the code default `full`.
 */
export async function resolveVocabularyStrategy(db: PipelineDb, workspaceId: string) {
  const raw = await getWorkspaceSetting<unknown>(db, workspaceId, 'extraction.vocabulary_strategy', null)
  const id = strategyIdFromSetting(raw) ?? defaultVocabularyStrategy().id
  return getVocabularyStrategy(id)
}

export const DEFAULT_BLIND_MERGE_THRESHOLD = 0.85

/**
 * Read the blind-merge cosine-similarity threshold for a workspace.
 * Key: `extraction.blind_merge_threshold`. Falls back to the code default
 * when the setting is missing or malformed.
 */
export async function resolveBlindMergeThreshold(db: PipelineDb, workspaceId: string): Promise<number> {
  const raw = await getWorkspaceSetting<unknown>(db, workspaceId, 'extraction.blind_merge_threshold', null)
  if (typeof raw === 'number' && raw >= 0 && raw <= 1)
    return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw)
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1)
      return parsed
  }
  return DEFAULT_BLIND_MERGE_THRESHOLD
}

function llmRoleFromSettingKey(key: KnownSettingKey): 'agent' | 'extraction' | 'embedding' | null {
  const match = key.match(/^llm\.(agent|extraction|embedding)\./)
  if (!match)
    return null
  return match[1] as 'agent' | 'extraction' | 'embedding'
}

function llmSettingField(key: KnownSettingKey): 'provider' | 'model' | 'base_url' | null {
  const match = key.match(/^llm\.(?:agent|extraction|embedding)\.(provider|model|base_url)$/)
  if (!match)
    return null
  return match[1] as 'provider' | 'model' | 'base_url'
}

/**
 * Resolve LLM provider settings for a role from workspace_settings with
 * env fallback. Returns overrides suitable for `resolveLLMProvider`.
 */
export async function resolveLLMProviderSettings(
  db: PipelineDb,
  workspaceId: string,
  role: 'agent' | 'extraction',
  env: EnvMap = process.env,
): Promise<ResolvedProviderSettings> {
  const keys = KEYS[role]
  const provider = await getWorkspaceSetting<string | null>(db, workspaceId, `llm.${role}.provider`, env[keys.provider] ?? null)
  const model = await getWorkspaceSetting<string | null>(db, workspaceId, `llm.${role}.model`, env[keys.model] ?? null)
  const baseUrl = await getWorkspaceSetting<string | null>(db, workspaceId, `llm.${role}.base_url`, env[keys.baseUrl] ?? null)
  return {
    provider: provider ?? undefined,
    model: model ?? undefined,
    base_url: baseUrl ?? undefined,
  }
}

/**
 * Resolve embedding provider settings from workspace_settings with env
 * fallback. Returns overrides suitable for `resolveEmbeddingProvider`.
 */
export async function resolveEmbeddingProviderSettings(
  db: PipelineDb,
  workspaceId: string,
  env: EnvMap = process.env,
): Promise<ResolvedProviderSettings> {
  const keys = KEYS.embedding
  const provider = await getWorkspaceSetting<string | null>(db, workspaceId, 'llm.embedding.provider', env[keys.provider] ?? null)
  const model = await getWorkspaceSetting<string | null>(db, workspaceId, 'llm.embedding.model', env[keys.model] ?? null)
  const baseUrl = await getWorkspaceSetting<string | null>(db, workspaceId, 'llm.embedding.base_url', env[keys.baseUrl] ?? null)
  return {
    provider: provider ?? undefined,
    model: model ?? undefined,
    base_url: baseUrl ?? undefined,
  }
}

/**
 * Resolve all known workspace settings, annotating each value with whether it
 * came from a workspace_settings row or the hardcoded code default (or env
 * runtime default, which is reported as source 'default').
 */
export async function resolveWorkspaceSettings(
  db: PipelineDb,
  workspaceId: string,
  env: EnvMap = process.env,
): Promise<ResolvedSettings> {
  const rows = await db
    .selectFrom('workspace_settings')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', KNOWN_SETTING_KEYS as unknown as string[])
    .execute()

  const workspaceValues = new Map<string, Json>(rows.map(r => [r.key, r.value]))

  function resolveLLM(role: 'agent' | 'extraction' | 'embedding') {
    const providerKey = `llm.${role}.provider` as KnownSettingKey
    const modelKey = `llm.${role}.model` as KnownSettingKey
    const baseUrlKey = `llm.${role}.base_url` as KnownSettingKey
    const envKeys = KEYS[role]

    const envProvider = env[envKeys.provider]
    const provider = workspaceValues.get(providerKey) ?? envProvider ?? DEFAULT_LLM_PROVIDER

    const envModel = env[envKeys.model]
    const defaultModel = provider === 'openrouter'
      ? (role === 'embedding' ? DEFAULT_EMBEDDING_MODEL : DEFAULT_CHAT_MODEL)
      : null
    const model = workspaceValues.get(modelKey) ?? envModel ?? defaultModel

    const envBaseUrl = env[envKeys.baseUrl]
    const defaultBaseUrl = provider === 'openrouter' ? OPENROUTER_BASE_URL : OLLAMA_BASE_URL
    const baseUrl = workspaceValues.get(baseUrlKey) ?? envBaseUrl ?? defaultBaseUrl

    return {
      provider: { value: provider, source: workspaceValues.has(providerKey) ? 'workspace' : 'default' as const },
      model: { value: model, source: workspaceValues.has(modelKey) ? 'workspace' : 'default' as const },
      base_url: { value: baseUrl, source: workspaceValues.has(baseUrlKey) ? 'workspace' : 'default' as const },
    }
  }

  const agent = resolveLLM('agent')
  const extraction = resolveLLM('extraction')
  const embedding = resolveLLM('embedding')

  const onboardingCompletedAt = workspaceValues.get('onboarding.completed_at') ?? null

  return {
    'extraction.vocabulary_strategy': {
      value: workspaceValues.get('extraction.vocabulary_strategy') ?? defaultVocabularyStrategy().id,
      source: workspaceValues.has('extraction.vocabulary_strategy') ? 'workspace' : 'default',
    },
    'extraction.blind_merge_threshold': {
      value: workspaceValues.get('extraction.blind_merge_threshold') ?? DEFAULT_BLIND_MERGE_THRESHOLD,
      source: workspaceValues.has('extraction.blind_merge_threshold') ? 'workspace' : 'default',
    },
    'llm.agent.provider': agent.provider,
    'llm.agent.model': agent.model,
    'llm.agent.base_url': agent.base_url,
    'llm.extraction.provider': extraction.provider,
    'llm.extraction.model': extraction.model,
    'llm.extraction.base_url': extraction.base_url,
    'llm.embedding.provider': embedding.provider,
    'llm.embedding.model': embedding.model,
    'llm.embedding.base_url': embedding.base_url,
    'onboarding.completed_at': {
      value: onboardingCompletedAt,
      source: workspaceValues.has('onboarding.completed_at') ? 'workspace' : 'default',
    },
  }
}

/**
 * Assert that a setting key is known and return it narrowed. Throws a clear
 * error otherwise.
 */
export function assertKnownSettingKey(key: unknown): KnownSettingKey {
  if (typeof key !== 'string' || !KNOWN_SETTING_KEYS.includes(key as KnownSettingKey)) {
    throw new Error(`unknown setting key: '${key}'`)
  }
  return key as KnownSettingKey
}

const VALID_VOCABULARY_STRATEGIES = ['top-k', 'blind-merge', 'full'] as const
const VALID_LLM_PROVIDERS = ['openrouter', 'ollama'] as const

/**
 * Validate and normalize a setting value for a known key. Throws a clear error
 * for invalid values; returns the JSON-safe value ready for workspace_settings.
 */
export function normalizeSettingValue(key: KnownSettingKey, value: unknown): Json {
  if (key === 'extraction.vocabulary_strategy') {
    if (
      typeof value !== 'string'
      || !(VALID_VOCABULARY_STRATEGIES as readonly string[]).includes(value)
    ) {
      throw new Error(`invalid vocabulary strategy: '${value}'`)
    }
    return value
  }

  if (key === 'extraction.blind_merge_threshold') {
    const raw = typeof value === 'number' ? value : Number.parseFloat(typeof value === 'string' ? value : '')
    if (Number.isNaN(raw) || raw <= 0 || raw > 1) {
      throw new Error('threshold must be a number in (0, 1]')
    }
    return raw
  }

  const field = llmSettingField(key)
  if (field) {
    if (field === 'provider') {
      if (typeof value !== 'string' || !(VALID_LLM_PROVIDERS as readonly string[]).includes(value)) {
        throw new Error(`invalid provider: '${value}' — expected 'openrouter' or 'ollama'`)
      }
      return value
    }
    if (field === 'model') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('model must be a non-empty string')
      }
      return value.trim()
    }
    if (field === 'base_url') {
      if (value !== null && value !== undefined && typeof value !== 'string') {
        throw new Error('base_url must be a string')
      }
      return value === undefined ? null : value
    }
  }

  if (key === 'onboarding.completed_at') {
    if (value === null || value === undefined)
      return null
    if (typeof value !== 'string' || value.trim().length === 0)
      throw new Error('onboarding.completed_at must be a valid ISO timestamp or null')
    const trimmed = value.trim()
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('onboarding.completed_at must be a valid ISO timestamp or null')
    return parsed.toISOString()
  }

  throw new Error(`unknown setting key: '${key}'`)
}

/**
 * Determine whether a known key is part of the LLM provider configuration.
 */
export function isLLMSettingKey(key: KnownSettingKey): boolean {
  return llmRoleFromSettingKey(key) !== null
}
