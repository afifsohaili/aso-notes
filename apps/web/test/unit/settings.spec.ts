import type { EnvMap } from '../../server/lib/ai/registry'
import type { PipelineDb } from '../../server/lib/pipeline/types'
import type { KnownSettingKey } from '../../server/lib/settings'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, OLLAMA_BASE_URL, OPENROUTER_BASE_URL } from '../../server/lib/ai/registry'
import {
  assertKnownSettingKey,
  DEFAULT_BLIND_MERGE_THRESHOLD,
  DEFAULT_LLM_PROVIDER,
  getWorkspaceSetting,
  normalizeSettingValue,
  resolveBlindMergeThreshold,
  resolveEmbeddingProviderSettings,
  resolveLLMProviderSettings,
  resolveVocabularyStrategy,
  resolveWorkspaceSettings,
} from '../../server/lib/settings'

function env(overrides: Record<string, string | undefined> = {}): EnvMap {
  return { ...overrides }
}

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
    const settings = await resolveWorkspaceSettings(db, 'ws-1', env())

    expect(settings).toEqual({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: DEFAULT_BLIND_MERGE_THRESHOLD, source: 'default' },
      'llm.agent.provider': { value: DEFAULT_LLM_PROVIDER, source: 'default' },
      'llm.agent.model': { value: DEFAULT_CHAT_MODEL, source: 'default' },
      'llm.agent.base_url': { value: OPENROUTER_BASE_URL, source: 'default' },
      'llm.extraction.provider': { value: DEFAULT_LLM_PROVIDER, source: 'default' },
      'llm.extraction.model': { value: DEFAULT_CHAT_MODEL, source: 'default' },
      'llm.extraction.base_url': { value: OPENROUTER_BASE_URL, source: 'default' },
      'llm.embedding.provider': { value: DEFAULT_LLM_PROVIDER, source: 'default' },
      'llm.embedding.model': { value: DEFAULT_EMBEDDING_MODEL, source: 'default' },
      'llm.embedding.base_url': { value: OPENROUTER_BASE_URL, source: 'default' },
      'onboarding.completed_at': { value: null, source: 'default' },
    })
  })

  it('returns workspace values with source workspace when rows exist', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'blind-merge' },
      { workspace_id: 'ws-1', key: 'extraction.blind_merge_threshold', value: 0.92 },
      { workspace_id: 'ws-1', key: 'llm.agent.provider', value: 'ollama' },
      { workspace_id: 'ws-1', key: 'llm.agent.model', value: 'gemma3:4b' },
      { workspace_id: 'ws-1', key: 'llm.embedding.provider', value: 'ollama' },
      { workspace_id: 'ws-1', key: 'llm.embedding.model', value: 'nomic-embed-text' },
    ])
    const settings = await resolveWorkspaceSettings(db, 'ws-1', env())

    expect(settings).toEqual({
      'extraction.vocabulary_strategy': { value: 'blind-merge', source: 'workspace' },
      'extraction.blind_merge_threshold': { value: 0.92, source: 'workspace' },
      'llm.agent.provider': { value: 'ollama', source: 'workspace' },
      'llm.agent.model': { value: 'gemma3:4b', source: 'workspace' },
      'llm.agent.base_url': { value: OLLAMA_BASE_URL, source: 'default' },
      'llm.extraction.provider': { value: DEFAULT_LLM_PROVIDER, source: 'default' },
      'llm.extraction.model': { value: DEFAULT_CHAT_MODEL, source: 'default' },
      'llm.extraction.base_url': { value: OPENROUTER_BASE_URL, source: 'default' },
      'llm.embedding.provider': { value: 'ollama', source: 'workspace' },
      'llm.embedding.model': { value: 'nomic-embed-text', source: 'workspace' },
      'llm.embedding.base_url': { value: OLLAMA_BASE_URL, source: 'default' },
      'onboarding.completed_at': { value: null, source: 'default' },
    })
  })

  it('uses env values as default source for unsaved llm keys', async () => {
    const db = fakeDb([])
    const settings = await resolveWorkspaceSettings(db, 'ws-1', env({
      NUXT_LLM_AGENT_PROVIDER: 'ollama',
      NUXT_LLM_AGENT_MODEL: 'qwen2.5:7b',
      NUXT_LLM_AGENT_BASE_URL: 'http://ollama:11434',
      NUXT_LLM_EXTRACTION_PROVIDER: 'ollama',
      NUXT_LLM_EXTRACTION_MODEL: 'qwen2.5:7b',
      NUXT_LLM_EMBEDDING_PROVIDER: 'ollama',
      NUXT_LLM_EMBEDDING_MODEL: 'nomic-embed-text',
    }))

    expect(settings['llm.agent.provider']).toEqual({ value: 'ollama', source: 'default' })
    expect(settings['llm.agent.model']).toEqual({ value: 'qwen2.5:7b', source: 'default' })
    expect(settings['llm.agent.base_url']).toEqual({ value: 'http://ollama:11434', source: 'default' })
    expect(settings['llm.embedding.provider']).toEqual({ value: 'ollama', source: 'default' })
    expect(settings['llm.embedding.base_url']).toEqual({ value: OLLAMA_BASE_URL, source: 'default' })
  })

  it('ignores unknown keys from the database', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'extraction.vocabulary_strategy', value: 'full' },
      { workspace_id: 'ws-1', key: 'future.key', value: 'ignored' },
    ])
    const settings = await resolveWorkspaceSettings(db, 'ws-1', env())

    expect(settings['extraction.vocabulary_strategy']).toEqual({ value: 'full', source: 'workspace' })
    expect(settings['extraction.blind_merge_threshold']).toEqual({ value: DEFAULT_BLIND_MERGE_THRESHOLD, source: 'default' })
    expect(settings['llm.agent.provider']).toEqual({ value: DEFAULT_LLM_PROVIDER, source: 'default' })
    expect(settings['onboarding.completed_at']).toEqual({ value: null, source: 'default' })
  })
})

describe('assertKnownSettingKey', () => {
  it('accepts known keys', () => {
    expect(assertKnownSettingKey('extraction.vocabulary_strategy')).toBe('extraction.vocabulary_strategy')
    expect(assertKnownSettingKey('extraction.blind_merge_threshold')).toBe('extraction.blind_merge_threshold')
    expect(assertKnownSettingKey('llm.agent.provider')).toBe('llm.agent.provider')
    expect(assertKnownSettingKey('llm.agent.model')).toBe('llm.agent.model')
    expect(assertKnownSettingKey('llm.agent.base_url')).toBe('llm.agent.base_url')
    expect(assertKnownSettingKey('llm.embedding.provider')).toBe('llm.embedding.provider')
    expect(assertKnownSettingKey('llm.embedding.model')).toBe('llm.embedding.model')
    expect(assertKnownSettingKey('llm.embedding.base_url')).toBe('llm.embedding.base_url')
    expect(assertKnownSettingKey('onboarding.completed_at')).toBe('onboarding.completed_at')
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

  describe('llm keys', () => {
    it('accepts a known provider', () => {
      expect(normalizeSettingValue('llm.agent.provider', 'openrouter')).toBe('openrouter')
      expect(normalizeSettingValue('llm.embedding.provider', 'ollama')).toBe('ollama')
    })

    it('rejects an unknown provider', () => {
      expect(() => normalizeSettingValue('llm.extraction.provider', 'mistral')).toThrow('invalid provider')
    })

    it('rejects a non-string provider', () => {
      expect(() => normalizeSettingValue('llm.agent.provider', 123)).toThrow('invalid provider')
    })

    it('accepts a non-empty model string', () => {
      expect(normalizeSettingValue('llm.agent.model', 'deepseek/deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash')
      expect(normalizeSettingValue('llm.embedding.model', 'nomic-embed-text')).toBe('nomic-embed-text')
    })

    it('rejects an empty or whitespace model', () => {
      expect(() => normalizeSettingValue('llm.agent.model', '')).toThrow('model must be a non-empty string')
      expect(() => normalizeSettingValue('llm.agent.model', '   ')).toThrow('model must be a non-empty string')
    })

    it('rejects a non-string model', () => {
      expect(() => normalizeSettingValue('llm.embedding.model', 123)).toThrow('model must be a non-empty string')
    })

    it('accepts a string base_url', () => {
      expect(normalizeSettingValue('llm.agent.base_url', 'http://localhost:11434')).toBe('http://localhost:11434')
    })

    it('allows null or undefined base_url to clear an override', () => {
      expect(normalizeSettingValue('llm.agent.base_url', null)).toBeNull()
      expect(normalizeSettingValue('llm.embedding.base_url', undefined)).toBeNull()
    })

    it('rejects a non-string base_url', () => {
      expect(() => normalizeSettingValue('llm.extraction.base_url', 123)).toThrow('base_url must be a string')
    })

    it('accepts null for onboarding.completed_at', () => {
      expect(normalizeSettingValue('onboarding.completed_at', null)).toBeNull()
    })

    it('normalizes a valid ISO timestamp for onboarding.completed_at', () => {
      expect(normalizeSettingValue('onboarding.completed_at', '2026-07-30T12:00:00Z')).toBe('2026-07-30T12:00:00.000Z')
    })

    it('rejects an invalid timestamp for onboarding.completed_at', () => {
      expect(() => normalizeSettingValue('onboarding.completed_at', 'not-a-date')).toThrow('onboarding.completed_at must be a valid ISO timestamp or null')
    })
  })
})

describe('resolveLLMProviderSettings', () => {
  it('prefers workspace rows over env', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'llm.agent.provider', value: 'ollama' },
      { workspace_id: 'ws-1', key: 'llm.agent.model', value: 'gemma3:4b' },
      { workspace_id: 'ws-1', key: 'llm.agent.base_url', value: 'http://workspace:11434' },
    ])
    const settings = await resolveLLMProviderSettings(db, 'ws-1', 'agent', env({
      NUXT_LLM_AGENT_PROVIDER: 'openrouter',
      NUXT_LLM_AGENT_MODEL: 'deepseek/deepseek-v4-flash',
      NUXT_LLM_AGENT_BASE_URL: 'http://env:11434',
    }))

    expect(settings).toEqual({
      provider: 'ollama',
      model: 'gemma3:4b',
      base_url: 'http://workspace:11434',
    })
  })

  it('falls back to env when workspace rows are absent', async () => {
    const db = fakeDb([])
    const settings = await resolveLLMProviderSettings(db, 'ws-1', 'extraction', env({
      NUXT_LLM_EXTRACTION_PROVIDER: 'ollama',
      NUXT_LLM_EXTRACTION_MODEL: 'qwen2.5:7b',
      NUXT_LLM_EXTRACTION_BASE_URL: 'http://env:11434',
    }))

    expect(settings).toEqual({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      base_url: 'http://env:11434',
    })
  })

  it('falls back to null when no workspace or env value exists', async () => {
    const db = fakeDb([])
    const settings = await resolveLLMProviderSettings(db, 'ws-1', 'agent', env())

    expect(settings).toEqual({
      provider: undefined,
      model: undefined,
      base_url: undefined,
    })
  })
})

describe('resolveEmbeddingProviderSettings', () => {
  it('prefers workspace rows over env', async () => {
    const db = fakeDb([
      { workspace_id: 'ws-1', key: 'llm.embedding.provider', value: 'ollama' },
      { workspace_id: 'ws-1', key: 'llm.embedding.model', value: 'nomic-embed-text' },
    ])
    const settings = await resolveEmbeddingProviderSettings(db, 'ws-1', env({
      NUXT_LLM_EMBEDDING_PROVIDER: 'openrouter',
      NUXT_LLM_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    }))

    expect(settings).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
      base_url: undefined,
    })
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
