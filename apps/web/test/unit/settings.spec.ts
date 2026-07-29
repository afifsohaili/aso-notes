import type { PipelineDb } from '../../server/lib/pipeline/types'
import type { KnownSettingKey } from '../../server/lib/settings'
import { describe, expect, it } from 'vitest'
import {
  assertKnownSettingKey,
  DEFAULT_BLIND_MERGE_THRESHOLD,
  getWorkspaceSetting,
  normalizeSettingValue,
  resolveBlindMergeThreshold,
  resolveVocabularyStrategy,
  resolveWorkspaceSettings,
} from '../../server/lib/settings'

function fakeDb(rows: { workspace_id: string, key: string, value: unknown }[] = []): PipelineDb {
  const query = () => {
    let workspaceId: string | undefined
    let key: string | string[] | undefined
    let op: string | undefined
    let selected: string[] = []

    const chain: any = {
      selectAll() {
        selected = ['*']
        return chain
      },
      select(cols: string[]) {
        selected = cols
        return chain
      },
      where(col: string, operator: string, val: unknown) {
        op = operator
        if (col === 'workspace_id')
          workspaceId = val as string
        if (col === 'key')
          key = val as string | string[]
        return chain
      },
      async execute() {
        const matches = rows.filter((r) => {
          if (r.workspace_id !== workspaceId)
            return false
          if (key === undefined)
            return true
          if (op === 'in' && Array.isArray(key))
            return key.includes(r.key)
          return r.key === key
        })
        if (selected.includes('key'))
          return matches
        if (selected.includes('value'))
          return matches.map(r => ({ value: r.value }))
        return matches
      },
      async executeTakeFirst() {
        const result = await chain.execute()
        return result[0] ?? null
      },
      async executeTakeFirstOrThrow() {
        const result = await chain.executeTakeFirst()
        if (!result)
          throw new Error('not found')
        return result
      },
    }
    return chain
  }

  return {
    selectFrom: () => query(),
  } as unknown as PipelineDb
}

describe('getWorkspaceSetting', () => {
  it('returns the stored jsonb value parsed as T', async () => {
    const db = fakeDb([{ workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'blind-merge' }])
    const value = await getWorkspaceSetting<string>(db, 'ws-1', 'extraction.vocabulary_strategy', 'top-k')
    expect(value).toBe('blind-merge')
  })

  it('returns fallback when no row exists', async () => {
    const db = fakeDb([])
    const value = await getWorkspaceSetting<string>(db, 'ws-1', 'missing.key', 'fallback')
    expect(value).toBe('fallback')
  })

  it('returns fallback for object values when stored value is missing', async () => {
    const db = fakeDb([])
    const value = await getWorkspaceSetting<{ enabled: boolean }>(db, 'ws-1', 'feature.flags', { enabled: true })
    expect(value).toEqual({ enabled: true })
  })
})

describe('resolveVocabularyStrategy', () => {
  it('reads extraction.vocabulary_strategy from workspace settings', async () => {
    const db = fakeDb([{ workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'blind-merge' }])
    const strategy = await resolveVocabularyStrategy(db, 'ws-1')
    expect(strategy.id).toBe('blind-merge')
  })

  it('falls back to top-k when setting is absent', async () => {
    const db = fakeDb([])
    const strategy = await resolveVocabularyStrategy(db, 'ws-1')
    expect(strategy.id).toBe('top-k')
  })
})

describe('resolveWorkspaceSettings', () => {
  it('returns defaults with source default when no workspace rows exist', async () => {
    const db = fakeDb([])
    const settings = await resolveWorkspaceSettings(db, 'ws-1')

    expect(settings).toEqual({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: DEFAULT_BLIND_MERGE_THRESHOLD, source: 'default' },
    })
  })

  it('returns workspace values with source workspace when rows exist', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'blind-merge' },
      { workspace_id: 'ws-1', key: 'extraction.blind_merge_threshold', value: 0.92 },
    ])
    const settings = await resolveWorkspaceSettings(db, 'ws-1')

    expect(settings).toEqual({
      'extraction.vocabulary_strategy': { value: 'blind-merge', source: 'workspace' },
      'extraction.blind_merge_threshold': { value: 0.92, source: 'workspace' },
    })
  })

  it('ignores unknown keys from the database', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'full' },
      { workspace_id: 'ws-1', key: 'future.key', value: 'ignored' },
    ])
    const settings = await resolveWorkspaceSettings(db, 'ws-1')

    expect(settings).toEqual({
      'extraction.vocabulary_strategy': { value: 'full', source: 'workspace' },
      'extraction.blind_merge_threshold': { value: DEFAULT_BLIND_MERGE_THRESHOLD, source: 'default' },
    })
  })
})

describe('assertKnownSettingKey', () => {
  it('accepts known keys', () => {
    expect(assertKnownSettingKey('extraction.vocabulary_strategy')).toBe('extraction.vocabulary_strategy')
    expect(assertKnownSettingKey('extraction.blind_merge_threshold')).toBe('extraction.blind_merge_threshold')
  })

  it('throws for unknown keys', () => {
    expect(() => assertKnownSettingKey('unknown.key')).toThrow('unknown setting key')
  })

  it('throws for non-string keys', () => {
    expect(() => assertKnownSettingKey(null)).toThrow('unknown setting key')
  })
})

describe('normalizeSettingValue', () => {
  it('accepts valid vocabulary strategies', () => {
    expect(normalizeSettingValue('extraction.vocabulary_strategy', 'top-k')).toBe('top-k')
    expect(normalizeSettingValue('extraction.vocabulary_strategy', 'blind-merge')).toBe('blind-merge')
    expect(normalizeSettingValue('extraction.vocabulary_strategy', 'full')).toBe('full')
  })

  it('rejects invalid vocabulary strategies', () => {
    expect(() => normalizeSettingValue('extraction.vocabulary_strategy', 'nearest-neighbor')).toThrow('invalid vocabulary strategy')
  })

  it('rejects non-string vocabulary strategies', () => {
    expect(() => normalizeSettingValue('extraction.vocabulary_strategy', 123)).toThrow('invalid vocabulary strategy')
  })

  it('accepts a valid threshold in (0, 1]', () => {
    expect(normalizeSettingValue('extraction.blind_merge_threshold', 0.85)).toBe(0.85)
    expect(normalizeSettingValue('extraction.blind_merge_threshold', 1)).toBe(1)
    expect(normalizeSettingValue('extraction.blind_merge_threshold', 0.001)).toBe(0.001)
  })

  it('parses a numeric string threshold', () => {
    expect(normalizeSettingValue('extraction.blind_merge_threshold', '0.72')).toBe(0.72)
  })

  it('rejects thresholds outside (0, 1]', () => {
    expect(() => normalizeSettingValue('extraction.blind_merge_threshold', 0)).toThrow('threshold must be a number in (0, 1]')
    expect(() => normalizeSettingValue('extraction.blind_merge_threshold', 1.1)).toThrow('threshold must be a number in (0, 1]')
    expect(() => normalizeSettingValue('extraction.blind_merge_threshold', -0.1)).toThrow('threshold must be a number in (0, 1]')
  })

  it('rejects non-numeric thresholds', () => {
    expect(() => normalizeSettingValue('extraction.blind_merge_threshold', 'high')).toThrow('threshold must be a number in (0, 1]')
  })

  it('rejects unknown keys', () => {
    expect(() => normalizeSettingValue('unknown.key' as KnownSettingKey, 'x')).toThrow('unknown setting key')
  })
})

describe('resolveBlindMergeThreshold', () => {
  it('returns the stored number value', async () => {
    const db = fakeDb([{ workspace_id: 'ws-1', key: 'extraction.blind_merge_threshold', value: 0.92 }])
    const threshold = await resolveBlindMergeThreshold(db, 'ws-1')
    expect(threshold).toBe(0.92)
  })

  it('parses a string value', async () => {
    const db = fakeDb([{ workspace_id: 'ws-1', key: 'extraction.blind_merge_threshold', value: '0.72' }])
    const threshold = await resolveBlindMergeThreshold(db, 'ws-1')
    expect(threshold).toBe(0.72)
  })

  it('falls back to the code default when setting is absent', async () => {
    const db = fakeDb([])
    const threshold = await resolveBlindMergeThreshold(db, 'ws-1')
    expect(threshold).toBe(DEFAULT_BLIND_MERGE_THRESHOLD)
  })

  it('falls back to the code default for out-of-range values', async () => {
    const db = fakeDb([{ workspace_id: 'ws-1', key: 'extraction.blind_merge_threshold', value: 1.5 }])
    const threshold = await resolveBlindMergeThreshold(db, 'ws-1')
    expect(threshold).toBe(DEFAULT_BLIND_MERGE_THRESHOLD)
  })
})
