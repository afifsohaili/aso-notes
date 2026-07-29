import type { PipelineDb } from '../../../server/lib/pipeline/types'
import type { EmbeddedChunk } from '../../../server/lib/pipeline/vocabulary/types'
import { describe, expect, it } from 'vitest'
import { getVocabularyStrategy, registerVocabularyStrategy } from '../../../server/lib/pipeline/vocabulary'
import { blindMergeStrategy } from '../../../server/lib/pipeline/vocabulary/blind-merge'
import { fullVocabularyStrategy } from '../../../server/lib/pipeline/vocabulary/full'
import { topKStrategy } from '../../../server/lib/pipeline/vocabulary/top-k'

function fakeDb(rows: {
  concepts?: { id: string, name: string, description: string | null, embedding: string | null }[]
  tags?: { name: string }[]
  topics?: { id: string, name: string, description: string | null }[]
} = {}): PipelineDb {
  return {
    selectFrom: (table: string) => {
      const chain: any = {
        selectAll() { return chain },
        select(cols: string[]) {
          chain._select = cols
          return chain
        },
        where(_col: string, _op: string, _val: unknown) { return chain },
        orderBy(_col: string, _dir?: string) { return chain },
        async execute() {
          if (table === 'concepts')
            return rows.concepts ?? []
          if (table === 'tags')
            return rows.tags ?? []
          if (table === 'topics')
            return rows.topics ?? []
          return []
        },
        async executeTakeFirstOrThrow() { throw new Error('not used') },
      }
      return chain
    },
  } as unknown as PipelineDb
}

function vec(values: number[]): string {
  return `[${values.join(',')}]`
}

function embeddedChunks(embeddings: number[][]): EmbeddedChunk[] {
  return embeddings.map((embedding, index) => ({ index, text: `chunk ${index}`, tokenCount: 1, headingPath: [], embedding }))
}

describe('vocabulary strategy registry', () => {
  it('returns built-in strategies by id', () => {
    expect(getVocabularyStrategy('full').id).toBe('full')
    expect(getVocabularyStrategy('top-k').id).toBe('top-k')
    expect(getVocabularyStrategy('blind-merge').id).toBe('blind-merge')
  })

  it('throws on unknown strategy id', () => {
    expect(() => getVocabularyStrategy('unknown' as any)).toThrow('unknown vocabulary strategy')
  })

  it('allows custom strategy registration', () => {
    const custom = {
      id: 'custom',
      async loadVocabulary() {
        return { concepts: [], tags: [], topics: [] }
      },
      mergeOnStore: false,
    }
    registerVocabularyStrategy(custom)
    expect(getVocabularyStrategy('custom')).toBe(custom)
  })
})

describe('full vocabulary strategy', () => {
  it('returns all concepts, tags, and topics for the workspace', async () => {
    const db = fakeDb({
      concepts: [
        { id: 'c1', name: 'Kysely', description: 'type-safe SQL', embedding: null },
        { id: 'c2', name: 'Graph RAG', description: 'retrieval over graph', embedding: null },
      ],
      tags: [{ name: 'databases' }, { name: 'ai' }],
      topics: [{ id: 't1', name: 'Engineering', description: 'building software' }],
    })

    const vocab = await fullVocabularyStrategy.loadVocabulary(db, 'ws-1', [])

    expect(vocab.concepts).toEqual([
      { id: 'c1', name: 'Kysely', description: 'type-safe SQL' },
      { id: 'c2', name: 'Graph RAG', description: 'retrieval over graph' },
    ])
    expect(vocab.tags).toEqual(['databases', 'ai'])
    expect(vocab.topics).toEqual([
      { id: 't1', name: 'Engineering', description: 'building software' },
    ])
    expect(fullVocabularyStrategy.mergeOnStore).toBe(false)
  })

  it('returns empty arrays for an empty workspace', async () => {
    const db = fakeDb()
    const vocab = await fullVocabularyStrategy.loadVocabulary(db, 'ws-1', [])
    expect(vocab).toEqual({ concepts: [], tags: [], topics: [] })
  })
})

describe('top-k vocabulary strategy', () => {
  it('returns full topic list + full tag list + top-K concepts by centroid similarity', async () => {
    const chunks = embeddedChunks([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ])
    // centroid = [0.5, 0.5, 0, 0]
    const db = fakeDb({
      concepts: [
        { id: 'near', name: 'Near Concept', description: 'near', embedding: vec([1, 1, 0, 0]) },
        { id: 'far', name: 'Far Concept', description: 'far', embedding: vec([0, 0, 1, 1]) },
        { id: 'no-embed', name: 'No Embedding', description: 'no embed', embedding: null },
      ],
      tags: [{ name: 't1' }],
      topics: [{ id: 'topic-1', name: 'Engineering', description: null }],
    })

    const vocab = await topKStrategy({ k: 1 }).loadVocabulary(db, 'ws-1', chunks)

    expect(vocab.topics).toEqual([{ id: 'topic-1', name: 'Engineering', description: null }])
    expect(vocab.tags).toEqual(['t1'])
    expect(vocab.concepts).toHaveLength(1)
    expect(vocab.concepts[0]!.id).toBe('near')
  })

  it('excludes concepts without embeddings from ranking', async () => {
    const chunks = embeddedChunks([[1, 0, 0]])
    const db = fakeDb({
      concepts: [
        { id: 'no-embed', name: 'No Embedding', description: 'x', embedding: null },
      ],
    })

    const vocab = await topKStrategy({ k: 5 }).loadVocabulary(db, 'ws-1', chunks)

    expect(vocab.concepts).toEqual([])
  })

  it('returns all ranked concepts when fewer than K exist', async () => {
    const chunks = embeddedChunks([[1, 0]])
    const db = fakeDb({
      concepts: [
        { id: 'a', name: 'A', description: 'a', embedding: vec([1, 0]) },
      ],
    })

    const vocab = await topKStrategy({ k: 50 }).loadVocabulary(db, 'ws-1', chunks)

    expect(vocab.concepts).toHaveLength(1)
  })

  it('defaults K to 50', () => {
    expect(topKStrategy({}).loadVocabulary).toBeDefined()
  })
})

describe('blind-merge vocabulary strategy', () => {
  it('returns empty concepts and mergeOnStore=true, but keeps tags and topics', async () => {
    const db = fakeDb({
      concepts: [{ id: 'c1', name: 'Kysely', description: 'sql', embedding: null }],
      tags: [{ name: 'databases' }],
      topics: [{ id: 't1', name: 'Engineering', description: null }],
    })

    const vocab = await blindMergeStrategy.loadVocabulary(db, 'ws-1', [])

    expect(vocab.concepts).toEqual([])
    expect(vocab.tags).toEqual(['databases'])
    expect(vocab.topics).toEqual([{ id: 't1', name: 'Engineering', description: null }])
    expect(blindMergeStrategy.mergeOnStore).toBe(true)
  })
})
