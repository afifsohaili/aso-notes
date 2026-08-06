import type { ConsolidationJudge, MergeVerdict, PruneVerdict } from '../../server/lib/consolidation/engine'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import { runConsolidation } from '../../server/lib/consolidation/engine'
import { runConsolidationSweep } from '../../server/lib/consolidation/job'
import { ConsolidationLockConflictError } from '../../server/lib/consolidation/lock'
import { executeConceptMerge, executeTopicMerge } from '../../server/lib/consolidation/merge'
import { executePruneConcept, executePruneTopic } from '../../server/lib/consolidation/prune'
import { pairId } from '../../server/lib/consolidation/shortlist'
import { restoreSnapshot } from '../../server/lib/consolidation/snapshot'
import { queryCypher } from '../../server/lib/graph/age'
import { ensureNotesGraphCatalog } from './age-catalog'

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

function fakeJudgeThatKeepsAll(): ConsolidationJudge {
  return async () => ({ merges: [], prunes: [] })
}

function fakeJudgeThatMergesAll(): ConsolidationJudge {
  return async ({ mergePairs, pruneCandidates }) => {
    const merges: MergeVerdict[] = mergePairs.map(pair => ({
      kind: pair.kind,
      pairId: pair.pairId,
      merge: true,
      survivorId: pair.id,
      mergedDescription: pair.description,
      reason: 'fake judge: merge all',
    }))
    const prunes: PruneVerdict[] = pruneCandidates.map(candidate => ({
      kind: candidate.kind,
      id: candidate.id,
      prune: false,
      reason: 'fake judge: keep all',
    }))
    return { merges, prunes }
  }
}

async function seedGraph(trx: any, workspaceId: string) {
  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: '/tmp/notes' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      synced_folder_id: syncedFolder.id,
      path: '/note.md',
      title: 'Note',
      content: 'content',
      content_hash: 'hash-note',
      status: 'ingested',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const chunk = await trx
    .insertInto('chunks')
    .values({ workspace_id: workspaceId, note_id: note.id, seq: 0, text: 'chunk' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  return { note, chunk, syncedFolder }
}

describe('consolidation engine', () => {
  test('creates a completed run, captures snapshot, and records metrics', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    const result = await runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatKeepsAll() })

    expect(result.status).toBe('completed')
    expect(result.runId).toBeDefined()

    const run = await trx
      .selectFrom('consolidation_runs')
      .selectAll()
      .where('id', '=', result.runId)
      .executeTakeFirstOrThrow()

    expect(run.mode).toBe('full')
    expect(run.status).toBe('completed')
    expect(run.error).toBeNull()
    expect(run.metrics_before).toBeDefined()
    expect(run.metrics_after).toBeDefined()

    const snapshot = await trx
      .selectFrom('consolidation_snapshots')
      .selectAll()
      .where('run_id', '=', result.runId)
      .executeTakeFirstOrThrow()

    expect(snapshot.workspace_id).toBe(workspace.id)
    expect((snapshot.payload as any).concepts).toHaveLength(0)
  })

  test('enforces the per-run budget and defers overflow', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const concepts: Array<{ id: string }> = []
    const angles = [0, 2, 90, 92, 180, 182]
    for (let i = 0; i < angles.length; i++) {
      const c = await trx
        .insertInto('concepts')
        .values({
          workspace_id: workspace.id,
          name: `Concept ${i}`,
          name_normalized: `concept ${i}`,
          description: `description ${i}`,
          embedding: halfvecLiteral(unitVector(angles[i]!)),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      concepts.push(c)
    }

    for (const c of concepts) {
      await trx.insertInto('mentions').values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: c.id }).execute()
    }

    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspace.id}, 'consolidation.run_budget', ${JSON.stringify(2)}::jsonb)
    `.execute(trx)

    const mergeJudge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: pair.id,
        mergedDescription: pair.description,
        reason: 'fake judge: merge all',
      })),
      prunes: [],
    })

    await runConsolidation(trx, workspace.id, 'full', { judge: mergeJudge })

    const remaining = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    // Budget of 2 means 2 merges applied, reducing 6 concepts to 4.
    expect(remaining).toHaveLength(4)

    const firstRun = await trx
      .selectFrom('consolidation_runs')
      .select('counts')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow()

    expect((firstRun.counts as any).merges).toBe(2)

    // Second run with same budget should process the remaining pair.
    await runConsolidation(trx, workspace.id, 'full', { judge: mergeJudge })

    const afterSecond = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(afterSecond).toHaveLength(3)
  })

  test('prunes junk concepts judged by the injected judge', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { note: _note, chunk } = await seedGraph(trx, workspace.id)

    const keeper = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Keeper Concept',
        name_normalized: 'keeper concept',
        description: 'keeper description',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const junk = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Junk Concept',
        name_normalized: 'junk concept',
        description: 'junk description',
        embedding: halfvecLiteral(unitVector(10)),
        created_at: new Date('2020-01-01T00:00:00Z'),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: keeper.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: junk.id },
    ]).execute()

    await trx.insertInto('relations').values({
      workspace_id: workspace.id,
      from_concept_id: keeper.id,
      to_concept_id: junk.id,
      type: 'related',
      description: 'keeper to junk',
    }).execute()

    const pruneJudge: ConsolidationJudge = async ({ pruneCandidates }) => ({
      merges: [],
      prunes: pruneCandidates.map(candidate => ({
        kind: candidate.kind,
        id: candidate.id,
        prune: candidate.name.includes('Junk'),
        reason: 'fake judge: prune junk',
      })),
    })

    await runConsolidation(trx, workspace.id, 'full', { judge: pruneJudge, now: new Date('2026-01-01T00:00:00Z') })

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(concepts.map(c => c.name)).toEqual(['Keeper Concept'])

    const mentions = await trx
      .selectFrom('mentions')
      .select('concept_id')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.concept_id).toBe(keeper.id)

    const relations = await trx
      .selectFrom('relations')
      .selectAll()
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(relations).toHaveLength(0)

    const changes = await trx
      .selectFrom('consolidation_run_changes')
      .select(['action', 'text'])
      .execute()

    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('prune')
  })

  test('merges duplicate topics and re-files concepts', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({ workspace_id: workspace.id, name: 'Concept A', name_normalized: 'concept a', description: 'a', embedding: halfvecLiteral(unitVector(0)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const topicX = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Topic X', name_normalized: 'topic x', description: 'x', embedding: halfvecLiteral(unitVector(10)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const topicY = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Topic Y', name_normalized: 'topic y', description: 'y', embedding: halfvecLiteral(unitVector(0)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('concept_topics').values([
      { workspace_id: workspace.id, concept_id: a.id, topic_id: topicX.id },
      { workspace_id: workspace.id, concept_id: a.id, topic_id: topicY.id },
    ]).execute()

    const judge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: pair.id,
        mergedDescription: pair.description,
        reason: 'fake judge: merge topics',
      })),
      prunes: [],
    })

    await runConsolidation(trx, workspace.id, 'full', { judge })

    const topics = await trx
      .selectFrom('topics')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(topics).toHaveLength(1)
    expect(topics.map(t => t.name)).toContain('Topic X')

    const conceptTopics = await trx
      .selectFrom('concept_topics')
      .select('topic_id')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(conceptTopics).toHaveLength(1)
    expect(conceptTopics[0]!.topic_id).toBe(topicX.id)

    const topicChanges = await trx
      .selectFrom('consolidation_run_changes')
      .select(['action', 'text'])
      .execute()

    expect(topicChanges).toHaveLength(1)
    expect(topicChanges[0]!.action).toBe('merge-topic')
  })

  test('incremental mode only processes concepts created since the last successful run', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Old Concept A',
        name_normalized: 'old concept a',
        description: 'old a',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Old Concept B',
        name_normalized: 'old concept b',
        description: 'old b',
        embedding: halfvecLiteral(unitVector(45)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    for (const c of [a, b]) {
      await trx.insertInto('mentions').values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: c.id }).execute()
    }

    // Full run establishes HWM and does not merge (a and b are dissimilar).
    await runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatMergesAll() })

    const newConcept = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'New Concept Similar To A',
        name_normalized: 'new concept similar to a',
        description: 'new',
        embedding: halfvecLiteral(unitVector(2)),
        created_at: new Date('2099-01-01T00:00:00Z'),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: newConcept.id }).execute()

    const mergeJudge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: pair.id,
        mergedDescription: pair.description,
        reason: 'fake judge: merge incremental',
      })),
      prunes: [],
    })

    await runConsolidation(trx, workspace.id, 'incremental', { judge: mergeJudge })

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .execute()

    // Only new concept should have been merged into A; B stays untouched.
    expect(concepts).toHaveLength(2)
    expect(concepts.map(c => c.name).sort()).toEqual(['New Concept Similar To A', 'Old Concept B'].sort())
  })

  test('re-points mentions, relations, and concept_topics on concept merge', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { note: _note, chunk } = await seedGraph(trx, workspace.id)

    const topicX = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Topic X', name_normalized: 'topic x', description: 'x', embedding: halfvecLiteral(unitVector(90)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const topicY = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Topic Y', name_normalized: 'topic y', description: 'y', embedding: halfvecLiteral(unitVector(170)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Concept A',
        name_normalized: 'concept a',
        description: 'description a',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Concept B',
        name_normalized: 'concept b',
        description: 'description b',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const c = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Concept C',
        name_normalized: 'concept c',
        description: 'description c',
        embedding: halfvecLiteral(unitVector(80)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    await trx.insertInto('relations').values([
      { workspace_id: workspace.id, from_concept_id: a.id, to_concept_id: c.id, type: 'related', description: 'a-c relation' },
      { workspace_id: workspace.id, from_concept_id: b.id, to_concept_id: c.id, type: 'related', description: 'b-c relation' },
    ]).execute()

    await trx.insertInto('concept_topics').values([
      { workspace_id: workspace.id, concept_id: a.id, topic_id: topicX.id },
      { workspace_id: workspace.id, concept_id: b.id, topic_id: topicY.id },
    ]).execute()

    const judge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: pair.id,
        mergedDescription: 'merged description',
        reason: 'fake judge: merge',
      })),
      prunes: [],
    })

    await runConsolidation(trx, workspace.id, 'full', { judge })

    const concepts = await trx
      .selectFrom('concepts')
      .select(['id', 'name', 'description'])
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(concepts).toHaveLength(2)
    const survivor = concepts.find(c => c.name === 'Concept A')!
    expect(survivor.description).toBe('merged description')

    const mentions = await trx
      .selectFrom('mentions')
      .select('concept_id')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.concept_id).toBe(survivor.id)

    const relations = await trx
      .selectFrom('relations')
      .select(['from_concept_id', 'to_concept_id', 'description'])
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(relations).toHaveLength(1)
    expect(relations[0]!.from_concept_id).toBe(survivor.id)
    expect(relations[0]!.to_concept_id).toBe(c.id)
    expect(relations[0]!.description).toBe('a-c relation')

    const conceptTopics = await trx
      .selectFrom('concept_topics')
      .select(['concept_id', 'topic_id'])
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(conceptTopics).toHaveLength(2)
    expect(conceptTopics.every(ct => ct.concept_id === survivor.id)).toBe(true)
    expect(conceptTopics.map(ct => ct.topic_id).sort()).toEqual([topicX.id, topicY.id].sort())

    const changes = await trx
      .selectFrom('consolidation_run_changes')
      .select(['action', 'text'])
      .execute()

    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('merge-concept')
  })

  test('deletes empty topics and dissolves singleton topics when the judge says dissolve', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({ workspace_id: workspace.id, name: 'Concept A', name_normalized: 'concept a', description: 'a', embedding: halfvecLiteral(unitVector(0)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const _emptyTopic = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Empty Topic', name_normalized: 'empty topic', description: 'empty', embedding: halfvecLiteral(unitVector(90)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const singletonTopic = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Singleton Topic', name_normalized: 'singleton topic', description: 'singleton', embedding: halfvecLiteral(unitVector(100)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const keepTopic = await trx
      .insertInto('topics')
      .values({ workspace_id: workspace.id, name: 'Keep Topic', name_normalized: 'keep topic', description: 'keep', embedding: halfvecLiteral(unitVector(170)) })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('concept_topics').values([
      { workspace_id: workspace.id, concept_id: a.id, topic_id: singletonTopic.id },
      { workspace_id: workspace.id, concept_id: a.id, topic_id: keepTopic.id },
    ]).execute()

    const judge: ConsolidationJudge = async ({ pruneCandidates }) => ({
      merges: [],
      prunes: pruneCandidates.map(candidate => ({
        kind: candidate.kind,
        id: candidate.id,
        prune: candidate.name.includes('Singleton'),
        reason: 'fake judge: dissolve singleton',
      })),
    })

    await runConsolidation(trx, workspace.id, 'full', { judge })

    const topics = await trx
      .selectFrom('topics')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(topics.map(t => t.name)).toEqual(['Keep Topic'])

    const conceptTopics = await trx
      .selectFrom('concept_topics')
      .select('topic_id')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(conceptTopics).toHaveLength(1)
    expect(conceptTopics[0]!.topic_id).toBe(keepTopic.id)

    const changes = await trx
      .selectFrom('consolidation_run_changes')
      .select(['action', 'text'])
      .orderBy('created_at')
      .execute()

    const actions = changes.map(c => c.action)
    expect(actions).toContain('prune')
    expect(actions).toContain('dissolve')
  })

  test('raises the over-pruning flag when concept count drops >20%', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const concepts: Array<{ id: string }> = []
    const angles = [0, 2, 90, 92, 180, 182, 270, 272, 45, 47]
    for (let i = 0; i < angles.length; i++) {
      const c = await trx
        .insertInto('concepts')
        .values({
          workspace_id: workspace.id,
          name: `Concept ${i}`,
          name_normalized: `concept ${i}`,
          description: `description ${i}`,
          embedding: halfvecLiteral(unitVector(angles[i]!)),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      concepts.push(c)
    }

    for (const c of concepts) {
      await trx.insertInto('mentions').values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: c.id }).execute()
    }

    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspace.id}, 'consolidation.run_budget', ${JSON.stringify(10)}::jsonb)
    `.execute(trx)

    const mergeJudge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: pair.id,
        mergedDescription: pair.description,
        reason: 'fake judge: merge all',
      })),
      prunes: [],
    })

    const result = await runConsolidation(trx, workspace.id, 'full', { judge: mergeJudge })

    expect(result.flags.overPruning).toBe(true)
  })

  test('re-mirrors AGE so the graph matches the relational state after the run', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { note: _note, chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    await runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatMergesAll() })

    const vertexCount = await queryCypher<{ n: unknown }>(
      trx,
      `MATCH (n:Concept {workspace_id: '${workspace.id}'}) RETURN count(n) AS n`,
      'n ag_catalog.agtype',
    )

    expect(Number(vertexCount[0]!.n)).toBe(1)

    const edgeCount = await queryCypher<{ n: unknown }>(
      trx,
      `MATCH ()-[r:MENTIONS {workspace_id: '${workspace.id}'}]->() RETURN count(r) AS n`,
      'n ag_catalog.agtype',
    )

    expect(Number(edgeCount[0]!.n)).toBe(1)
  })

  test('captures snapshot before mutations so restore returns the original state', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    await runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatMergesAll() })

    const run = await trx
      .selectFrom('consolidation_runs')
      .select('id')
      .where('workspace_id', '=', workspace.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow()

    const snapshot = await trx
      .selectFrom('consolidation_snapshots')
      .select('id')
      .where('run_id', '=', run.id)
      .executeTakeFirstOrThrow()

    await restoreSnapshot(trx, snapshot.id, workspace.id)

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(concepts.map(c => c.name)).toEqual(['Duplicate Alpha', 'Duplicate Beta'])
  })

  test('merges duplicate concepts judged by the injected judge', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha description',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta description',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    await trx.insertInto('relations').values({
      workspace_id: workspace.id,
      from_concept_id: a.id,
      to_concept_id: b.id,
      type: 'related',
      description: 'a-b relation',
    }).execute()

    await runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatMergesAll() })

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(concepts).toHaveLength(1)
    expect(concepts.map(c => c.name)).toContain('Duplicate Alpha')

    const changes = await trx
      .selectFrom('consolidation_run_changes')
      .select(['action', 'text', 'reason'])
      .execute()

    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('merge-concept')
  })

  test('skips a hallucinated self-merge verdict without deleting the concept', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha description',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta description',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    // Judge hallucinates a self-pair: survivor === loser would wipe the concept.
    const judge: ConsolidationJudge = async () => ({
      merges: [{
        kind: 'concept',
        pairId: `${a.id}::${a.id}`,
        merge: true,
        survivorId: a.id,
        mergedDescription: null,
        reason: 'hallucinated self-merge',
      }],
      prunes: [],
    })

    const result = await runConsolidation(trx, workspace.id, 'full', { judge })

    expect(result.counts.merges).toBe(0)
    expect(result.counts.skippedInvalidVerdicts).toBe(1)

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(concepts.map(c => c.name)).toEqual(['Duplicate Alpha', 'Duplicate Beta'])

    const mentions = await trx
      .selectFrom('mentions')
      .select('concept_id')
      .where('workspace_id', '=', workspace.id)
      .execute()

    expect(mentions).toHaveLength(2)
  })

  test('skips a verdict whose survivor is not a member of the judged pair', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha description',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta description',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const outsider = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Outsider Concept',
        name_normalized: 'outsider concept',
        description: 'outsider',
        embedding: halfvecLiteral(unitVector(90)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: outsider.id },
    ]).execute()

    // Judge returns the real pair but names an outsider as survivor — executing
    // this would merge two unrelated concepts.
    const judge: ConsolidationJudge = async ({ mergePairs }) => ({
      merges: mergePairs.map(pair => ({
        kind: pair.kind,
        pairId: pair.pairId,
        merge: true,
        survivorId: outsider.id,
        mergedDescription: null,
        reason: 'hallucinated outsider survivor',
      })),
      prunes: [],
    })

    const result = await runConsolidation(trx, workspace.id, 'full', { judge })

    expect(result.counts.merges).toBe(0)
    expect(result.counts.skippedInvalidVerdicts).toBeGreaterThanOrEqual(1)

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(concepts.map(c => c.name)).toEqual(['Duplicate Alpha', 'Duplicate Beta', 'Outsider Concept'])
  })

  test('skips verdicts for pairIds that were never judged', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const { chunk } = await seedGraph(trx, workspace.id)

    const a = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Alpha',
        name_normalized: 'duplicate alpha',
        description: 'alpha description',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const b = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspace.id,
        name: 'Duplicate Beta',
        name_normalized: 'duplicate beta',
        description: 'beta description',
        embedding: halfvecLiteral(unitVector(10)),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: a.id },
      { workspace_id: workspace.id, chunk_id: chunk.id, concept_id: b.id },
    ]).execute()

    const judge: ConsolidationJudge = async () => ({
      merges: [{
        kind: 'concept',
        pairId: `${crypto.randomUUID()}::${crypto.randomUUID()}`,
        merge: true,
        survivorId: a.id,
        mergedDescription: null,
        reason: 'fabricated pairId that was never judged',
      }],
      prunes: [],
    })

    const result = await runConsolidation(trx, workspace.id, 'full', { judge })

    expect(result.counts.merges).toBe(0)
    expect(result.counts.skippedInvalidVerdicts).toBeGreaterThanOrEqual(1)

    const concepts = await trx
      .selectFrom('concepts')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .orderBy('name')
      .execute()

    expect(concepts.map(c => c.name)).toEqual(['Duplicate Alpha', 'Duplicate Beta'])
  })

  test('caps singleton-topic dissolve judging at the remaining run budget', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    const angles = [0, 90, 180, 270]
    for (let i = 0; i < angles.length; i++) {
      const concept = await trx
        .insertInto('concepts')
        .values({
          workspace_id: workspace.id,
          name: `Concept ${i}`,
          name_normalized: `concept ${i}`,
          description: `description ${i}`,
          embedding: halfvecLiteral(unitVector(angles[i]!)),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      const topic = await trx
        .insertInto('topics')
        .values({
          workspace_id: workspace.id,
          name: `Singleton Topic ${i}`,
          name_normalized: `singleton topic ${i}`,
          description: `singleton ${i}`,
          embedding: halfvecLiteral(unitVector(angles[i]! + 45)),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      await trx.insertInto('concept_topics').values({
        workspace_id: workspace.id,
        concept_id: concept.id,
        topic_id: topic.id,
      }).execute()
    }

    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspace.id}, 'consolidation.run_budget', ${JSON.stringify(2)}::jsonb)
    `.execute(trx)

    const judgedCandidateIds: string[] = []
    const judge: ConsolidationJudge = async ({ pruneCandidates }) => {
      judgedCandidateIds.push(...pruneCandidates.map(c => c.id))
      return {
        merges: [],
        prunes: pruneCandidates.map(candidate => ({
          kind: candidate.kind,
          id: candidate.id,
          prune: true,
          reason: 'fake judge: dissolve all',
        })),
      }
    }

    const result = await runConsolidation(trx, workspace.id, 'full', { judge })

    // Budget of 2 with no merges/prunes: only 2 of the 4 singleton topics may be judged.
    expect(judgedCandidateIds).toHaveLength(2)
    expect(result.counts.dissolves).toBe(2)

    const topics = await trx
      .selectFrom('topics')
      .select('name')
      .where('workspace_id', '=', workspace.id)
      .execute()
    expect(topics).toHaveLength(2)
  })

  test('refuses to merge or prune rows that belong to another workspace', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const other = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    const foreignConceptA = await trx
      .insertInto('concepts')
      .values({ workspace_id: other.workspace.id, name: 'Foreign Concept A', name_normalized: 'foreign concept a', description: 'foreign a' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const foreignConceptB = await trx
      .insertInto('concepts')
      .values({ workspace_id: other.workspace.id, name: 'Foreign Concept B', name_normalized: 'foreign concept b', description: 'foreign b' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const foreignTopic = await trx
      .insertInto('topics')
      .values({ workspace_id: other.workspace.id, name: 'Foreign Topic', name_normalized: 'foreign topic', description: 'foreign topic' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const foreignTopicB = await trx
      .insertInto('topics')
      .values({ workspace_id: other.workspace.id, name: 'Foreign Topic B', name_normalized: 'foreign topic b', description: 'foreign topic b' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const run = await trx
      .insertInto('consolidation_runs')
      .values({ workspace_id: workspace.id, mode: 'manual', status: 'running' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    // Executing against `workspace` with verdicts referencing `other`'s rows
    // must reject — never mutate across the workspace boundary.
    await expect(executeConceptMerge(trx, workspace.id, {
      kind: 'concept',
      pairId: pairId(foreignConceptA.id, foreignConceptB.id),
      merge: true,
      survivorId: foreignConceptA.id,
      mergedDescription: 'hijacked description',
      reason: 'cross-workspace merge',
    }, run.id)).rejects.toThrow()

    await expect(executeTopicMerge(trx, workspace.id, {
      kind: 'topic',
      pairId: pairId(foreignTopic.id, foreignTopicB.id),
      merge: true,
      survivorId: foreignTopic.id,
      mergedDescription: 'hijacked description',
      reason: 'cross-workspace merge',
    }, run.id)).rejects.toThrow()

    await expect(executePruneConcept(trx, workspace.id, {
      kind: 'concept',
      id: foreignConceptA.id,
      prune: true,
      reason: 'cross-workspace prune',
    }, run.id)).rejects.toThrow()

    await expect(executePruneTopic(trx, workspace.id, {
      kind: 'topic',
      id: foreignTopic.id,
      prune: true,
      reason: 'cross-workspace prune',
    }, run.id)).rejects.toThrow()

    const foreignConcepts = await trx
      .selectFrom('concepts')
      .select(['name', 'description'])
      .where('workspace_id', '=', other.workspace.id)
      .orderBy('name')
      .execute()
    expect(foreignConcepts).toEqual([
      { name: 'Foreign Concept A', description: 'foreign a' },
      { name: 'Foreign Concept B', description: 'foreign b' },
    ])

    const foreignTopics = await trx
      .selectFrom('topics')
      .select('name')
      .where('workspace_id', '=', other.workspace.id)
      .execute()
    expect(foreignTopics).toHaveLength(2)

    const changes = await trx
      .selectFrom('consolidation_run_changes')
      .select('id')
      .where('run_id', '=', run.id)
      .execute()
    expect(changes).toHaveLength(0)
  })

  test('rejects a concurrent run while another session holds the workspace consolidation lock', async ({ db, trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    // Simulate an in-flight consolidation on another connection.
    const other = await db.startTransaction().execute()
    try {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))`.execute(other)

      await expect(
        runConsolidation(trx, workspace.id, 'full', { judge: fakeJudgeThatKeepsAll() }),
      ).rejects.toThrow(ConsolidationLockConflictError)

      // The conflicting attempt must not leave a run row behind.
      const runs = await trx
        .selectFrom('consolidation_runs')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .execute()
      expect(runs).toHaveLength(0)
    }
    finally {
      await other.rollback().execute()
    }
  })

  test('skips a cron sweep quietly when the workspace lock is held', async ({ db, trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedGraph(trx, workspace.id)

    const other = await db.startTransaction().execute()
    try {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))`.execute(other)

      const result = await runConsolidationSweep(trx, workspace.id, 'incremental', { judge: fakeJudgeThatKeepsAll() })
      expect(result).toBe('skipped')

      const runs = await trx
        .selectFrom('consolidation_runs')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .execute()
      expect(runs).toHaveLength(0)
    }
    finally {
      await other.rollback().execute()
    }
  })
})
