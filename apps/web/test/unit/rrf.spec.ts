import { describe, expect, it } from 'vitest'
import { fuseRankedLists } from '../../server/lib/retrieval'

describe('fuseRankedLists (RRF)', () => {
  it('returns an empty list for empty input', () => {
    expect(fuseRankedLists([])).toEqual([])
  })

  it('fuses a single list preserving rank order with RRF scores', () => {
    const result = fuseRankedLists([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    ])
    expect(result.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(result[0]!.score).toBeCloseTo(1 / 61)
    expect(result[1]!.score).toBeCloseTo(1 / 62)
    expect(result[2]!.score).toBeCloseTo(1 / 63)
  })

  it('sums RRF contributions across lists', () => {
    const result = fuseRankedLists([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'a' }],
    ])
    // a: rank1 in list1 + rank2 in list2 = 1/61 + 1/62
    // b: rank2 in list1 + rank1 in list2 = 1/62 + 1/61
    const a = result.find(r => r.id === 'a')!
    const b = result.find(r => r.id === 'b')!
    expect(a.score).toBeCloseTo(1 / 61 + 1 / 62)
    expect(b.score).toBeCloseTo(1 / 62 + 1 / 61)
  })

  it('ranks an item present in both lists above one present in a single list', () => {
    const result = fuseRankedLists([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'a' }],
    ])
    // a: 1/61 + 1/61, b: 1/62
    expect(result[0]!.id).toBe('a')
    expect(result[1]!.id).toBe('b')
  })

  it('handles disjoint lists', () => {
    const result = fuseRankedLists([
      [{ id: 'a' }],
      [{ id: 'b' }],
    ])
    expect(result.map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('breaks ties deterministically by id', () => {
    const result = fuseRankedLists([
      [{ id: 'b' }, { id: 'a' }],
      [{ id: 'a' }, { id: 'b' }],
    ])
    // both have equal RRF scores; tie broken by id ascending
    expect(result.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('rejects an unsupported fusion strategy', () => {
    expect(() => fuseRankedLists([[{ id: 'a' }]], { strategy: 'weighted' as never }))
      .toThrow()
  })

  it('defaults to RRF when no strategy is given', () => {
    const result = fuseRankedLists([[{ id: 'a' }]])
    expect(result[0]!.id).toBe('a')
    expect(result[0]!.score).toBeCloseTo(1 / 61)
  })
})
