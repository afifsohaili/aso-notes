import type { PipelineDb } from '../../server/lib/pipeline/types'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BLIND_MERGE_THRESHOLD,
  getWorkspaceSetting,
  resolveBlindMergeThreshold,
  resolveVocabularyStrategy,
} from '../../server/lib/settings'

function fakeDb(rows: { workspace_id: string, key: string, value: unknown }[] = []): PipelineDb {
  const query = () => {
    let workspaceId: string | undefined
    let key: string | undefined
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
      where(col: string, _op: string, val: unknown) {
        if (col === 'workspace_id')
          workspaceId = val as string
        if (col === 'key')
          key = val as string
        return chain
      },
      async execute() {
        const matches = rows.filter(r => r.workspace_id === workspaceId && r.key === key)
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
