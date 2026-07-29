import type { Json } from '@monorepo/shared'
import type { PipelineDb } from './pipeline/types'
import { defaultVocabularyStrategy, getVocabularyStrategy } from './pipeline/vocabulary'

/**
 * Known workspace-scoped setting keys. These are the only settings exposed
 * by the Settings UI; unknown keys are rejected at write time and ignored
 * at read time.
 */
export const KNOWN_SETTING_KEYS = [
  'extraction.vocabulary_strategy',
  'extraction.blind_merge_threshold',
] as const

export type KnownSettingKey = typeof KNOWN_SETTING_KEYS[number]

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
 * falls back to the code default `top-k`.
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

/**
 * Resolve all known workspace settings, annotating each value with whether it
 * came from a workspace_settings row or the hardcoded code default.
 */
export async function resolveWorkspaceSettings(
  db: PipelineDb,
  workspaceId: string,
): Promise<ResolvedSettings> {
  const rows = await db
    .selectFrom('workspace_settings')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', KNOWN_SETTING_KEYS as unknown as string[])
    .execute()

  const workspaceValues = new Map<string, Json>(rows.map(r => [r.key, r.value]))

  return {
    'extraction.vocabulary_strategy': {
      value: workspaceValues.get('extraction.vocabulary_strategy') ?? defaultVocabularyStrategy().id,
      source: workspaceValues.has('extraction.vocabulary_strategy') ? 'workspace' : 'default',
    },
    'extraction.blind_merge_threshold': {
      value: workspaceValues.get('extraction.blind_merge_threshold') ?? DEFAULT_BLIND_MERGE_THRESHOLD,
      source: workspaceValues.has('extraction.blind_merge_threshold') ? 'workspace' : 'default',
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

  throw new Error(`unknown setting key: '${key}'`)
}
