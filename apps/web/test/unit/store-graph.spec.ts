import { describe, expect, it } from 'vitest'
import { collectTopicNames, topicEmbeddingInput } from '../../server/lib/pipeline/stages/store-graph'

describe('store-graph topic helpers', () => {
  it('collects note-level topics and per-concept topic refs, deduped by normalized name', () => {
    const names = collectTopicNames({
      topics: [{ name: 'Engineering', description: 'software engineering' }],
      concepts: [
        { name: 'A', description: 'a', topics: ['Engineering', 'Billing'] },
        { name: 'B', description: 'b', topics: ['billing'] },
      ],
      relations: [],
      mentions: [],
      tags: [],
    })

    expect([...names.entries()].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['billing', { name: 'Billing', description: '' }],
      ['engineering', { name: 'Engineering', description: 'software engineering' }],
    ])
  })

  it('returns an empty map for an empty extraction', () => {
    expect(collectTopicNames({ topics: [], concepts: [], relations: [], mentions: [], tags: [] })).toEqual(new Map())
  })

  it('drops malformed topic names', () => {
    const names = collectTopicNames({
      topics: [{ name: '  !!!  ', description: '' }, { name: 'Valid', description: '' }],
      concepts: [{ name: 'A', description: 'a', topics: ['  ', 'Valid'] }],
      relations: [],
      mentions: [],
      tags: [],
    })
    expect([...names.keys()]).toEqual(['valid'])
  })

  it('formats topic embedding input as name: description', () => {
    expect(topicEmbeddingInput({ name: 'Engineering', description: 'software engineering' })).toBe('Engineering: software engineering')
  })
})
