import type { ChunkRef } from '../../server/lib/mention-gap'
import { describe, expect, it } from 'vitest'
import {
  extractTextTokens,
  findMentionGaps,
  generateConceptVariants,
  textMatchesConcept,
} from '../../server/lib/mention-gap'

describe('generateConceptVariants', () => {
  it('produces a single token variant for a one-word concept', () => {
    const variants = generateConceptVariants('Paddle')
    expect(variants).toEqual([{ type: 'token', value: 'paddle' }])
  })

  it('produces phrase variants for a multi-word concept', () => {
    const variants = generateConceptVariants('Graph RAG')
    const values = variants.map(v => v.value)
    expect(values).toEqual([
      'graph rag',
      'graph_rag',
      'graph-rag',
      'graphRag',
      'graphrag',
    ])
    expect(variants.every(v => v.type === 'phrase')).toBe(true)
  })

  it('trims extra whitespace', () => {
    const variants = generateConceptVariants('  Paddle   Billing ')
    expect(variants.map(v => v.value)).toContain('paddle billing')
    expect(variants.map(v => v.value)).toContain('paddleBilling')
  })

  it('preserves casing in camelCase variants', () => {
    const variants = generateConceptVariants('Stripe Checkout')
    expect(variants.map(v => v.value)).toContain('stripeCheckout')
  })
})

describe('extractTextTokens', () => {
  it('splits snake_case identifiers', () => {
    expect(extractTextTokens('paddle_id').sort()).toEqual(['id', 'paddle'])
  })

  it('splits camelCase identifiers', () => {
    expect(extractTextTokens('PaddleBillingService').sort()).toEqual([
      'billing',
      'paddle',
      'paddlebillingservice',
      'service',
    ])
  })

  it('splits kebab-case identifiers', () => {
    expect(extractTextTokens('paddle-billing-service').sort()).toEqual([
      'billing',
      'paddle',
      'service',
    ])
  })

  it('lowercases all tokens', () => {
    expect(extractTextTokens('Paddle_ID').sort()).toEqual(['id', 'paddle'])
  })
})

describe('textMatchesConcept', () => {
  it('matches a single-word concept inside a snake_case token', () => {
    const variants = generateConceptVariants('Paddle')
    expect(textMatchesConcept('The paddle_id field is required.', variants)).toBe(true)
  })

  it('matches a single-word concept inside a camelCase token', () => {
    const variants = generateConceptVariants('Paddle')
    expect(textMatchesConcept('Use PaddleBillingService instead.', variants)).toBe(true)
  })

  it('does not match a single-word concept as a partial substring', () => {
    const variants = generateConceptVariants('Paddle')
    expect(textMatchesConcept('paddling is fun', variants)).toBe(false)
  })

  it('matches a multi-word concept in compact form', () => {
    const variants = generateConceptVariants('Graph RAG')
    expect(textMatchesConcept('GraphRAG is powerful.', variants)).toBe(true)
  })

  it('matches a multi-word concept in snake_case', () => {
    const variants = generateConceptVariants('Graph RAG')
    expect(textMatchesConcept('The graph_rag pipeline runs nightly.', variants)).toBe(true)
  })

  it('matches a multi-word concept in kebab-case', () => {
    const variants = generateConceptVariants('Graph RAG')
    expect(textMatchesConcept('graph-rag', variants)).toBe(true)
  })

  it('is case-insensitive', () => {
    const variants = generateConceptVariants('Kysely')
    expect(textMatchesConcept('KYSELY is great', variants)).toBe(true)
  })

  it('does not match unrelated text', () => {
    const variants = generateConceptVariants('Stripe')
    expect(textMatchesConcept('We use Paddle for billing.', variants)).toBe(false)
  })
})

describe('findMentionGaps', () => {
  const concepts = [
    { id: 'c-paddle', name: 'Paddle', workspaceId: 'ws-1' },
    { id: 'c-graph-rag', name: 'Graph RAG', workspaceId: 'ws-1' },
  ]

  function chunk(id: string, noteId: string, text: string): ChunkRef {
    return {
      id,
      noteId,
      workspaceId: 'ws-1',
      text,
      noteTitle: noteId,
      notePath: `/${noteId}.md`,
    }
  }

  it('reports a gap when text matches but no mention exists', () => {
    const chunks = [chunk('ch-1', 'n-1', 'The paddle_id field is required.')]
    const report = findMentionGaps(concepts, chunks, [])

    expect(report.conceptSummaries).toHaveLength(1)
    expect(report.conceptSummaries[0]).toMatchObject({
      conceptId: 'c-paddle',
      conceptName: 'Paddle',
      matchingNotes: 1,
      mentionedNotes: 0,
      gap: 1,
    })
    expect(report.noteGaps).toHaveLength(1)
    expect(report.noteGaps[0]).toMatchObject({
      noteId: 'n-1',
      conceptId: 'c-paddle',
    })
  })

  it('does not report a gap when a mention exists', () => {
    const chunks = [chunk('ch-1', 'n-1', 'The paddle_id field is required.')]
    const mentions = [{ chunkId: 'ch-1', conceptId: 'c-paddle' }]
    const report = findMentionGaps(concepts, chunks, mentions)

    expect(report.conceptSummaries).toHaveLength(0)
    expect(report.noteGaps).toHaveLength(0)
  })

  it('only counts one matching note once per concept', () => {
    const chunks = [
      chunk('ch-1', 'n-1', 'paddle_id and paddleId'),
      chunk('ch-2', 'n-1', 'PaddleBillingService too'),
    ]
    const report = findMentionGaps(concepts, chunks, [])

    expect(report.conceptSummaries[0]!.matchingNotes).toBe(1)
    expect(report.noteGaps).toHaveLength(2)
  })

  it('does not cross workspace boundaries', () => {
    const chunks = [chunk('ch-1', 'n-1', 'paddle_id')]
    const otherConcept = { id: 'c-paddle-2', name: 'Paddle', workspaceId: 'ws-2' }
    const report = findMentionGaps([...concepts, otherConcept], chunks, [])

    expect(report.conceptSummaries).toHaveLength(1)
    expect(report.conceptSummaries[0]!.workspaceId).toBe('ws-1')
  })

  it('sorts concepts by gap desc then name asc', () => {
    const chunks = [
      chunk('ch-1', 'n-1', 'paddle_id'),
      chunk('ch-2', 'n-2', 'graph_rag'),
      chunk('ch-3', 'n-3', 'graphRag'),
    ]
    const report = findMentionGaps(concepts, chunks, [])

    expect(report.conceptSummaries.map(s => s.conceptName)).toEqual(['Graph RAG', 'Paddle'])
    expect(report.conceptSummaries[0]!.gap).toBe(2)
    expect(report.conceptSummaries[1]!.gap).toBe(1)
  })
})
