import type { PipelineDb } from './pipeline/types'
import { getVocabularyStrategy, topKStrategy } from './pipeline/vocabulary'

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
  const id = strategyIdFromSetting(raw) ?? topKStrategy().id
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
