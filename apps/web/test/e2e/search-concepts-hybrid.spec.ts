import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { searchConceptsTool } from '../../server/lib/agent/tools/search-concepts'
import { givenConcept, givenWorkspace, stubContext, stubEmbedding, vec } from './agent-stubs'

describe('search_concepts hybrid', () => {
  test('a query naming a concept exactly ranks it first even when semantically distant', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'concepts-hybrid-exact')
    const conceptA = await givenConcept(trx, workspaceId, 'Zephyr Protocol', vec(0, 1))
    await givenConcept(trx, workspaceId, 'Pasta', vec(1, 0))

    // conceptA matches the query name exactly but its embedding is orthogonal to
    // the query; conceptB is semantically close but shares no tokens with it.
    const result = await searchConceptsTool.execute(
      { query: 'Zephyr Protocol', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const concepts = (result.result as any).concepts
    expect(concepts[0].id).toBe(conceptA.id)
    expect(concepts[0].name).toBe('Zephyr Protocol')
  })

  test('a synonym query still finds the right concept via the dense leg', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'concepts-hybrid-synonym')
    const conceptA = await givenConcept(trx, workspaceId, 'The zephyr protocol handles retries', vec(1, 0))
    await givenConcept(trx, workspaceId, 'Cooking pasta', vec(0, 1))

    // conceptA is semantically close to the query but shares no tokens with it.
    const result = await searchConceptsTool.execute(
      { query: 'retry mechanism', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const concepts = (result.result as any).concepts
    expect(concepts[0].id).toBe(conceptA.id)
  })

  test('each concept carries a fused score, not a raw distance', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'concepts-hybrid-score')
    const conceptA = await givenConcept(trx, workspaceId, 'Zephyr Protocol', vec(1, 0))

    const result = await searchConceptsTool.execute(
      { query: 'zephyr', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const concepts = (result.result as any).concepts
    expect(concepts).toHaveLength(1)
    expect(concepts[0].id).toBe(conceptA.id)
    expect(typeof concepts[0].score).toBe('number')
    expect(concepts[0].distance).toBeUndefined()
  })

  test('results remain workspace-scoped', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'concepts-hybrid-ws-a')
    const wsB = await givenWorkspace(trx, 'concepts-hybrid-ws-b')
    await givenConcept(trx, wsA, 'Shared', vec(1, 0))
    const conceptB = await givenConcept(trx, wsB, 'Shared', vec(1, 0))

    const result = await searchConceptsTool.execute(
      { query: 'shared', limit: 5 },
      stubContext(trx, wsB, stubEmbedding(vec(1, 0))),
    )

    const concepts = (result.result as any).concepts
    expect(concepts).toHaveLength(1)
    expect(concepts[0].id).toBe(conceptB.id)
  })

  test('limit semantics are unchanged', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'concepts-hybrid-limit')
    await givenConcept(trx, workspaceId, 'Alpha Concept', vec(1, 0))
    await givenConcept(trx, workspaceId, 'Beta Concept', vec(0.9, 0.1))
    await givenConcept(trx, workspaceId, 'Gamma Concept', vec(0.8, 0.2))

    const result = await searchConceptsTool.execute(
      { query: 'concept', limit: 2 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const concepts = (result.result as any).concepts
    expect(concepts).toHaveLength(2)
  })
})
