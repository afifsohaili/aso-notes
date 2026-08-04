import { describe, expect, it } from 'vitest'
import { groupConceptsByTopic } from '../../app/utils/graph'
import { parseOptionalString, toConceptSummaries } from '../../server/lib/graph/ui'
import { rootNameFor } from '../../server/lib/notes/disambiguation'

describe('graph/ui response shaping', () => {
  describe('rootNameFor', () => {
    it('uses the alias when set', () => {
      expect(rootNameFor('/Users/x/plans', 'Roadmap')).toBe('Roadmap')
    })

    it('falls back to the basename when alias is null', () => {
      expect(rootNameFor('/Users/x/plans', null)).toBe('plans')
    })

    it('falls back to the basename when alias is undefined', () => {
      expect(rootNameFor('/Users/x/plans', undefined)).toBe('plans')
    })

    it('treats an empty or blank alias as unset', () => {
      expect(rootNameFor('/Users/x/plans', '')).toBe('plans')
      expect(rootNameFor('/Users/x/plans', '   ')).toBe('plans')
    })

    it('returns the alias trimmed of surrounding whitespace', () => {
      expect(rootNameFor('/Users/x/plans', '  Roadmap  ')).toBe('Roadmap')
    })

    it('strips a trailing slash before taking the basename', () => {
      expect(rootNameFor('/Users/x/plans/', null)).toBe('plans')
    })

    it('returns the basename for root-level paths', () => {
      expect(rootNameFor('/plans', null)).toBe('plans')
    })
  })

  describe('parseOptionalString', () => {
    it('unwraps JSON-encoded agtype strings', () => {
      expect(parseOptionalString('"hello"')).toBe('hello')
    })

    it('returns undefined for null', () => {
      expect(parseOptionalString(null)).toBeUndefined()
    })

    it('returns undefined for non-string values', () => {
      expect(parseOptionalString(42)).toBeUndefined()
    })
  })

  describe('toConceptSummaries', () => {
    it('orders concepts by mentionCount desc, then by name', () => {
      const rows = [
        { id: 'c1', name: 'Apple', description: 'desc1', mention_count: 1 },
        { id: 'c2', name: 'Banana', description: 'desc2', mention_count: 3 },
        { id: 'c3', name: 'Cherry', description: null, mention_count: 0 },
      ]

      expect(toConceptSummaries(rows)).toEqual([
        { id: 'c2', name: 'Banana', description: 'desc2', mentionCount: 3, topics: [] },
        { id: 'c1', name: 'Apple', description: 'desc1', mentionCount: 1, topics: [] },
        { id: 'c3', name: 'Cherry', description: null, mentionCount: 0, topics: [] },
      ])
    })

    it('coerces string/bigint mention counts to numbers', () => {
      const rows = [
        { id: 'c1', name: 'A', description: null, mention_count: '5' },
        { id: 'c2', name: 'B', description: null, mention_count: BigInt(2) },
      ]

      const result = toConceptSummaries(rows)
      expect(result[0]!.mentionCount).toBe(5)
      expect(result[1]!.mentionCount).toBe(2)
    })

    it('carries topic names through', () => {
      const rows = [
        { id: 'c1', name: 'Paddle', description: null, mention_count: 5, topics: ['Billing', 'Engineering'] },
        { id: 'c2', name: 'Kysely', description: null, mention_count: 3, topics: ['Engineering'] },
        { id: 'c3', name: 'Ghost', description: null, mention_count: 1, topics: [] },
      ]

      expect(toConceptSummaries(rows)).toEqual([
        { id: 'c1', name: 'Paddle', description: null, mentionCount: 5, topics: ['Billing', 'Engineering'] },
        { id: 'c2', name: 'Kysely', description: null, mentionCount: 3, topics: ['Engineering'] },
        { id: 'c3', name: 'Ghost', description: null, mentionCount: 1, topics: [] },
      ])
    })
  })

  describe('groupConceptsByTopic', () => {
    it('groups concepts under each of their topics and collects ungrouped', () => {
      const concepts = [
        { id: 'c1', name: 'Paddle', description: null, mentionCount: 5, topics: ['Billing', 'Engineering'] },
        { id: 'c2', name: 'Kysely', description: null, mentionCount: 3, topics: ['Engineering'] },
        { id: 'c3', name: 'Ghost', description: null, mentionCount: 1, topics: [] },
      ]

      expect(groupConceptsByTopic(concepts)).toEqual([
        { topic: 'Billing', concepts: [concepts[0]] },
        { topic: 'Engineering', concepts: [concepts[0], concepts[1]] },
        { topic: null, concepts: [concepts[2]] },
      ])
    })

    it('sorts topics alphabetically and keeps ungrouped last', () => {
      const concepts = [
        { id: 'c1', name: 'A', description: null, mentionCount: 0, topics: ['Zebra'] },
        { id: 'c2', name: 'B', description: null, mentionCount: 0, topics: ['Apple'] },
        { id: 'c3', name: 'C', description: null, mentionCount: 0, topics: [] },
      ]

      const grouped = groupConceptsByTopic(concepts)
      expect(grouped.map(g => g.topic)).toEqual(['Apple', 'Zebra', null])
    })

    it('returns only an ungrouped bucket when no concepts have topics', () => {
      const concepts = [
        { id: 'c1', name: 'A', description: null, mentionCount: 2, topics: [] },
      ]

      expect(groupConceptsByTopic(concepts)).toEqual([
        { topic: null, concepts: [concepts[0]] },
      ])
    })

    it('returns an empty array for empty input', () => {
      expect(groupConceptsByTopic([])).toEqual([])
    })
  })
})
