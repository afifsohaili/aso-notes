import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import { computeMetrics } from '../../server/lib/consolidation/metrics'

function unitVector(angleDegrees: number): number[] {
  const rad = angleDegrees * Math.PI / 180
  return Array.from({ length: 2048 }, (_, i) => {
    if (i === 0)
      return Math.cos(rad)
    if (i === 1)
      return Math.sin(rad)
    return 0
  })
}

async function givenConcept(trx: any, workspaceId: string, name: string, angle: number) {
  return trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name,
      name_normalized: name.toLowerCase(),
      description: `${name} description`,
      embedding: halfvecLiteral(unitVector(angle)),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()
}

describe('consolidation metrics', () => {
  test('nearDupeRate counts embedding pairs above the 0.9 cosine threshold', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()

    // 4 concepts → 6 pairs. Only the (0°, 1°) pair is above the threshold.
    await givenConcept(trx, workspace.id, 'Alpha', 0)
    await givenConcept(trx, workspace.id, 'Alpha Copy', 1)
    await givenConcept(trx, workspace.id, 'Orthogonal', 90)
    await givenConcept(trx, workspace.id, 'Opposite', 180)

    const metrics = await computeMetrics(trx, workspace.id)

    expect(metrics.concepts).toBe(4)
    expect(metrics.nearDupeRate).toBeCloseTo(1 / 6, 5)
  })

  test('nearDupeRate is zero when no pair is above the threshold', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()

    await givenConcept(trx, workspace.id, 'Alpha', 0)
    await givenConcept(trx, workspace.id, 'Orthogonal', 90)

    const metrics = await computeMetrics(trx, workspace.id)

    expect(metrics.nearDupeRate).toBe(0)
  })

  test('orphanRate counts concepts with no relations (per spec), regardless of topics', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()

    const linked = await givenConcept(trx, workspace.id, 'Linked', 0)
    const orphanA = await givenConcept(trx, workspace.id, 'Orphan A', 90)
    const orphanB = await givenConcept(trx, workspace.id, 'Orphan B', 180)

    const topic = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Topic', name_normalized: 'topic', description: 'topic' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    // Every concept has a Topic — a topic-based orphan measure would say 0,
    // but the spec defines orphan = 0 Relations.
    for (const concept of [linked, orphanA, orphanB]) {
      await trx.insertInto('concept_topics').values({
        workspace_id: workspace.id,
        concept_id: concept.id,
        topic_id: topic.id,
      }).execute()
    }

    await trx.insertInto('relations').values({
      workspace_id: workspace.id,
      from_concept_id: linked.id,
      to_concept_id: orphanA.id,
      type: 'related',
      description: 'link',
    }).execute()

    const metrics = await computeMetrics(trx, workspace.id)

    // Orphan B has no relation on either side → 1 of 3 concepts is an orphan.
    expect(metrics.orphanRate).toBeCloseTo(1 / 3, 5)
  })

  test('orphanRate is zero when every concept has a relation', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()

    const a = await givenConcept(trx, workspace.id, 'A', 0)
    const b = await givenConcept(trx, workspace.id, 'B', 90)

    await trx.insertInto('relations').values({
      workspace_id: workspace.id,
      from_concept_id: a.id,
      to_concept_id: b.id,
      type: 'related',
      description: 'link',
    }).execute()

    const metrics = await computeMetrics(trx, workspace.id)

    expect(metrics.orphanRate).toBe(0)
  })
})
