import { describe, expect, it } from 'vitest'
import { parseOptionalString, toConceptSummaries } from '../../server/lib/graph/ui'

describe('graph/ui response shaping', () => {
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
        { id: 'c2', name: 'Banana', description: 'desc2', mentionCount: 3 },
        { id: 'c1', name: 'Apple', description: 'desc1', mentionCount: 1 },
        { id: 'c3', name: 'Cherry', description: null, mentionCount: 0 },
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
  })
})
