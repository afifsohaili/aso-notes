import { describe, expect, it } from 'vitest'
import { cosineFromDistance, loserIdFromVerdict, pairId } from '../../server/lib/consolidation/shortlist'

describe('consolidation shortlist helpers', () => {
  it('pairId orders ids lexicographically', () => {
    expect(pairId('b', 'a')).toBe('a::b')
    expect(pairId('a', 'b')).toBe('a::b')
  })

  it('cosineFromDistance converts pgvector distance to similarity', () => {
    expect(cosineFromDistance(0)).toBe(1)
    expect(cosineFromDistance(0.25)).toBe(0.75)
    expect(cosineFromDistance(1)).toBe(0)
  })

  it('loserIdFromVerdict returns the non-survivor id from a pair', () => {
    const verdict = { pairId: pairId('a', 'b'), survivorId: 'a', merge: true, kind: 'concept' as const, mergedDescription: null, reason: '' }
    expect(loserIdFromVerdict(verdict)).toBe('b')

    const reversed = { pairId: pairId('a', 'b'), survivorId: 'b', merge: true, kind: 'concept' as const, mergedDescription: null, reason: '' }
    expect(loserIdFromVerdict(reversed)).toBe('a')
  })
})
