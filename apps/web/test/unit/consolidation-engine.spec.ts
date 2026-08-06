import type { ConsolidationJudge, MergeCandidate, PruneCandidate } from '../../server/lib/consolidation/types'
import { describe, expect, it } from 'vitest'
import { batchJudge, cosineFromDistance, loserIdFromVerdict, pairId } from '../../server/lib/consolidation/shortlist'
import { JUDGE_BATCH_SIZE } from '../../server/lib/consolidation/types'

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

function makePair(id1: string, id2: string, kind: 'concept' | 'topic' = 'concept'): MergeCandidate {
  return {
    kind,
    pairId: pairId(id1, id2),
    id: id1,
    name: `name ${id1}`,
    description: null,
    otherId: id2,
    otherName: `name ${id2}`,
    otherDescription: null,
    similarity: 0.9,
  }
}

function makePruneCandidate(id: string, kind: 'concept' | 'topic' = 'concept'): PruneCandidate {
  return {
    kind,
    id,
    name: `name ${id}`,
    description: null,
    mentionCount: 0,
    relationCount: 0,
    sampleChunkText: null,
  }
}

describe('batchJudge verdict validation', () => {
  it('drops merge verdicts referencing a pairId that was never judged', async () => {
    const judge: ConsolidationJudge = async () => ({
      merges: [{ kind: 'concept', pairId: pairId('ghost-1', 'ghost-2'), merge: true, survivorId: 'ghost-1', mergedDescription: null, reason: 'hallucinated' }],
      prunes: [],
    })

    const result = await batchJudge(judge, [makePair('a', 'b')], [])

    expect(result.merges).toHaveLength(0)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('drops a self-merge verdict even when the self-pair id was judged', async () => {
    // A self-pair can never be shortlisted legitimately, but defend anyway.
    const selfPair = { ...makePair('a', 'b'), pairId: 'a::a' }
    const judge: ConsolidationJudge = async () => ({
      merges: [{ kind: 'concept', pairId: 'a::a', merge: true, survivorId: 'a', mergedDescription: null, reason: 'self merge' }],
      prunes: [],
    })

    const result = await batchJudge(judge, [selfPair], [])

    expect(result.merges).toHaveLength(0)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('drops merge verdicts whose survivorId is not a member of the pair', async () => {
    const pair = makePair('a', 'b')
    const judge: ConsolidationJudge = async () => ({
      merges: [{ kind: 'concept', pairId: pair.pairId, merge: true, survivorId: 'c', mergedDescription: null, reason: 'outsider survivor' }],
      prunes: [],
    })

    const result = await batchJudge(judge, [pair], [])

    expect(result.merges).toHaveLength(0)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('drops merge verdicts whose kind does not match the judged pair', async () => {
    const pair = makePair('a', 'b', 'concept')
    const judge: ConsolidationJudge = async () => ({
      merges: [{ kind: 'topic', pairId: pair.pairId, merge: true, survivorId: 'a', mergedDescription: null, reason: 'wrong kind' }],
      prunes: [],
    })

    const result = await batchJudge(judge, [pair], [])

    expect(result.merges).toHaveLength(0)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('drops duplicate merge verdicts repeated across batches', async () => {
    const pairs = Array.from({ length: JUDGE_BATCH_SIZE + 1 }, (_, i) => makePair(`a${i}`, `b${i}`))
    const duplicateVerdict = {
      kind: 'concept' as const,
      pairId: pairs[0]!.pairId,
      merge: true,
      survivorId: pairs[0]!.id,
      mergedDescription: null,
      reason: 'same verdict every batch',
    }
    const judge: ConsolidationJudge = async () => ({ merges: [duplicateVerdict], prunes: [] })

    const result = await batchJudge(judge, pairs, [])

    expect(result.judgeCalls).toBe(2)
    expect(result.merges).toHaveLength(1)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('keeps valid verdicts for judged pairs', async () => {
    const pair = makePair('a', 'b')
    const judge: ConsolidationJudge = async () => ({
      merges: [{ kind: 'concept', pairId: pair.pairId, merge: true, survivorId: 'b', mergedDescription: 'merged', reason: 'duplicates' }],
      prunes: [],
    })

    const result = await batchJudge(judge, [pair], [])

    expect(result.merges).toHaveLength(1)
    expect(result.merges[0]!.survivorId).toBe('b')
    expect(result.skippedInvalidVerdicts).toBe(0)
  })

  it('drops prune verdicts referencing an id that was never judged', async () => {
    const judge: ConsolidationJudge = async () => ({
      merges: [],
      prunes: [{ kind: 'concept', id: 'ghost', prune: true, reason: 'hallucinated prune' }],
    })

    const result = await batchJudge(judge, [], [makePruneCandidate('a')])

    expect(result.prunes).toHaveLength(0)
    expect(result.skippedInvalidVerdicts).toBe(1)
  })

  it('drops duplicate prune verdicts and kind-mismatched prune verdicts', async () => {
    const candidate = makePruneCandidate('a', 'concept')
    const judge: ConsolidationJudge = async () => ({
      merges: [],
      prunes: [
        { kind: 'concept', id: 'a', prune: true, reason: 'first' },
        { kind: 'concept', id: 'a', prune: true, reason: 'duplicate' },
        { kind: 'topic', id: 'a', prune: true, reason: 'wrong kind' },
      ],
    })

    const result = await batchJudge(judge, [], [candidate])

    expect(result.prunes).toHaveLength(1)
    expect(result.skippedInvalidVerdicts).toBe(2)
  })
})
