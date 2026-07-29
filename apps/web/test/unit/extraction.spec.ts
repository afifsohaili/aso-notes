import { describe, expect, it } from 'vitest'
import {
  buildExtractionMessages,
  EXTRACTION_SCHEMA_NAME,
  normalizeGraphName,
  parseExtraction,
} from '../../server/lib/pipeline/extraction'

describe('normalizeGraphName', () => {
  it('lowercases, collapses whitespace and punctuation runs', () => {
    expect(normalizeGraphName('Graph  RAG')).toBe('graph rag')
    expect(normalizeGraphName('  Apache-AGE!! ')).toBe('apache age')
    expect(normalizeGraphName('Kysely')).toBe('kysely')
    expect(normalizeGraphName('retrieval-augmented generation')).toBe('retrieval augmented generation')
  })
})

describe('buildExtractionMessages', () => {
  const chunks = [
    { index: 0, text: 'alpha body', headingPath: ['Alpha'] },
    { index: 1, text: 'beta body', headingPath: ['Alpha', 'Beta'] },
  ]

  it('injects the cover chain, existing concepts, and tag hints into the user message', () => {
    const messages = buildExtractionMessages({
      noteTitle: 'My Note',
      notePath: '/proj/my-note.md',
      coverChain: 'project cover context',
      chunks,
      existingConcepts: [
        { name: 'Graph RAG', description: 'retrieval over a graph' },
        { name: 'Kysely', description: 'type-safe SQL' },
      ],
      existingTags: ['databases', 'ai'],
      existingTopics: [
        { name: 'Engineering', description: 'building software' },
      ],
      strategyLabel: 'existing vocabulary',
    })

    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    const user = messages[1]!.content as string
    expect(user).toContain('project cover context')
    expect(user).toContain('My Note')
    expect(user).toContain('/proj/my-note.md')
    expect(user).toContain('Graph RAG')
    expect(user).toContain('retrieval over a graph')
    expect(user).toContain('Kysely')
    expect(user).toContain('databases')
    expect(user).toContain('ai')
    expect(user).toContain('## Existing topics (reuse these when they fit)')
    expect(user).toContain('Engineering')
    expect(user).toContain('building software')
    // chunks are enumerated so the model can reference them by index
    expect(user).toContain('[chunk 0]')
    expect(user).toContain('[chunk 1]')
    expect(user).toContain('Alpha > Beta')
  })

  it('states explicitly when there are no existing concepts or tags', () => {
    const messages = buildExtractionMessages({
      noteTitle: 'n',
      notePath: '/n.md',
      chunks,
      existingConcepts: [],
      existingTags: [],
      existingTopics: [],
      strategyLabel: 'existing vocabulary',
    })
    const user = messages[1]!.content as string
    expect(user).toMatch(/no existing concepts/i)
    expect(user).toMatch(/no existing tags/i)
    expect(user).toMatch(/no existing topics/i)
  })

  it('omits the folder-context section when there is no cover chain', () => {
    const withCover = buildExtractionMessages({
      noteTitle: 'n',
      notePath: '/n.md',
      chunks,
      existingConcepts: [],
      existingTags: [],
      existingTopics: [],
      strategyLabel: 'existing vocabulary',
    })[1]!.content as string
    expect(withCover).not.toContain('Folder context')
  })

  it('labels the concepts section as top relevant when strategyLabel is provided', () => {
    const user = buildExtractionMessages({
      noteTitle: 'n',
      notePath: '/n.md',
      chunks,
      existingConcepts: [{ name: 'A', description: 'a' }],
      existingTags: [],
      existingTopics: [],
      strategyLabel: 'top relevant',
    })[1]!.content as string
    expect(user).toContain('## Existing concepts (top relevant, reuse these when they match)')
  })
})

describe('parseExtraction', () => {
  it('parses a well-formed payload verbatim', () => {
    const parsed = parseExtraction(JSON.stringify({
      concepts: [{ name: 'Alpha', description: 'first', topics: ['Engineering'] }],
      relations: [{ from: 'Alpha', to: 'Beta', type: 'enables', description: 'x' }],
      mentions: [{ concept: 'Alpha', chunkRefs: [0, 1] }],
      tags: ['databases'],
      topics: [{ name: 'Engineering', description: 'systems' }],
    }), 2)
    expect(parsed.concepts).toEqual([{ name: 'Alpha', description: 'first', topics: ['Engineering'] }])
    expect(parsed.relations).toEqual([{ from: 'Alpha', to: 'Beta', type: 'enables', description: 'x' }])
    expect(parsed.mentions).toEqual([{ concept: 'Alpha', chunkRefs: [0, 1] }])
    expect(parsed.tags).toEqual(['databases'])
    expect(parsed.topics).toEqual([{ name: 'Engineering', description: 'systems' }])
  })

  it('tolerates missing fields, defaulting them to empty lists', () => {
    const parsed = parseExtraction('{}', 3)
    expect(parsed).toEqual({ concepts: [], relations: [], mentions: [], tags: [], topics: [] })
  })

  it('drops chunk refs outside the chunk range and non-integers', () => {
    const parsed = parseExtraction(JSON.stringify({
      mentions: [{ concept: 'Alpha', chunkRefs: [0, 1, 5, -1, 1.5, 'x'] }],
    }), 2)
    expect(parsed.mentions).toEqual([{ concept: 'Alpha', chunkRefs: [0, 1] }])
  })

  it('drops mentions whose chunk refs are all invalid', () => {
    const parsed = parseExtraction(JSON.stringify({
      mentions: [
        { concept: 'Ghost', chunkRefs: [9] },
        { concept: 'Real', chunkRefs: [0] },
      ],
    }), 1)
    expect(parsed.mentions).toEqual([{ concept: 'Real', chunkRefs: [0] }])
  })

  it('drops malformed entries instead of failing the whole payload', () => {
    const parsed = parseExtraction(JSON.stringify({
      concepts: [
        { name: 'Good', description: 'ok' },
        { description: 'no name' },
        'just a string',
        { name: '  ', description: 'blank name' },
      ],
      relations: [
        { from: 'A', to: 'B', type: 'x' },
        { from: 'A', to: 'B' },
      ],
      tags: ['good', 42, '', null],
    }), 1)
    expect(parsed.concepts).toEqual([{ name: 'Good', description: 'ok', topics: [] }])
    expect(parsed.relations).toEqual([{ from: 'A', to: 'B', type: 'x' }])
    expect(parsed.tags).toEqual(['good'])
  })

  it('dedupes repeated chunk refs within a mention', () => {
    const parsed = parseExtraction(JSON.stringify({
      mentions: [{ concept: 'Alpha', chunkRefs: [0, 0, 1, 1] }],
    }), 2)
    expect(parsed.mentions).toEqual([{ concept: 'Alpha', chunkRefs: [0, 1] }])
  })

  it('throws when the payload is not valid JSON', () => {
    expect(() => parseExtraction('not json', 1)).toThrow()
  })
})

describe('eXTRACTION_SCHEMA_NAME', () => {
  it('is a stable identifier for the structured-output request', () => {
    expect(EXTRACTION_SCHEMA_NAME).toBe('graph_extraction')
  })
})
