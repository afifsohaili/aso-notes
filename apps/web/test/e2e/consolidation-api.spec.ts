import type { ConsolidationRuns } from '@monorepo/shared'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { CONSOLIDATION_QUEUE_NAME, ConsolidationJob } from '../../server/lib/consolidation/job'
import { captureSnapshot } from '../../server/lib/consolidation/snapshot'
import { queryCypher } from '../../server/lib/graph/age'
import { ensureNotesGraphCatalog } from './age-catalog'

function createRun(trx: any, workspaceId: string, overrides: Partial<ConsolidationRuns> = {}) {
  return trx
    .insertInto('consolidation_runs')
    .values({
      workspace_id: workspaceId,
      mode: 'manual',
      status: 'completed',
      counts: { merges: 1, prunes: 0, rewrites: 0, dissolves: 0, refiles: 0, judgeCalls: 1 },
      metrics_before: { concepts: 10, topics: 5, nearDupeRate: 0.1, orphanRate: 0.05, conceptsPerNote: 2, topicSpread: 1 },
      metrics_after: { concepts: 9, topics: 5, nearDupeRate: 0.05, orphanRate: 0.05, conceptsPerNote: 1.8, topicSpread: 1 },
      flags: { overPruning: false, ineffectiveness: false },
      ...overrides,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()
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

  const conceptA = await trx
    .insertInto('concepts')
    .values({ workspace_id: workspaceId, name: 'Concept A', name_normalized: 'concept a', description: 'a' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const conceptB = await trx
    .insertInto('concepts')
    .values({ workspace_id: workspaceId, name: 'Concept B', name_normalized: 'concept b', description: 'b' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const topicX = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Topic X', name_normalized: 'topic x', description: 'x' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  await trx.insertInto('mentions').values([
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptA.id },
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptB.id },
  ]).execute()

  await trx.insertInto('concept_topics').values([
    { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicX.id },
    { workspace_id: workspaceId, concept_id: conceptB.id, topic_id: topicX.id },
  ]).execute()

  return { note, chunk, conceptA, conceptB, topicX }
}

async function vertexCount(trx: any, workspaceId: string, label: string): Promise<number> {
  const rows = await queryCypher<{ n: unknown }>(
    trx,
    `MATCH (n:${label} {workspace_id: '${workspaceId}'}) RETURN count(n) AS n`,
    'n ag_catalog.agtype',
  )
  return Number(rows[0]!.n)
}

describe('consolidation API', () => {
  describe('pOST /api/consolidation/run', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/consolidation/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    })

    test('enqueues a full manual run and records the job', async ({ server, queue }) => {
      queue.setMode('fake')
      const { cookies } = await givenVerifiedUser()

      const res = await server('/api/consolidation/run', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ enqueued: true, mode: 'manual' })

      const jobs = queue.enqueuedJobs(CONSOLIDATION_QUEUE_NAME)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.name).toBe(ConsolidationJob.name)
      expect(jobs[0]!.data).toMatchObject({ mode: 'manual' })
    })
  })

  describe('gET /api/consolidation/runs', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/consolidation/runs')
      expect(res.status).toBe(401)
    })

    test('returns run history for the workspace', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const run = await createRun(trx, workspace.id)

      const res = await server('/api/consolidation/runs', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.runs).toHaveLength(1)
      expect(body.runs[0]).toMatchObject({
        id: run.id,
        mode: 'manual',
        status: 'completed',
        counts: { merges: 1, prunes: 0, rewrites: 0, dissolves: 0, refiles: 0, judgeCalls: 1 },
      })
    })
  })

  describe('gET /api/consolidation/runs/:id', () => {
    test('returns 401 when unauthenticated', async ({ server, trx }) => {
      const { workspace } = await givenVerifiedUser()
      const run = await createRun(trx, workspace.id)

      const res = await server(`/api/consolidation/runs/${run.id}`)
      expect(res.status).toBe(401)
    })

    test('returns run detail with changes and snapshot flag', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const run = await createRun(trx, workspace.id)
      await trx
        .insertInto('consolidation_run_changes')
        .values({
          run_id: run.id,
          action: 'merge-concept',
          text: 'Merged A into B',
          reason: 'same concept',
        })
        .execute()

      const res = await server(`/api/consolidation/runs/${run.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.run.id).toBe(run.id)
      expect(body.changes).toHaveLength(1)
      expect(body.changes[0]).toMatchObject({ action: 'merge-concept', text: 'Merged A into B', reason: 'same concept' })
      expect(body.hasSnapshot).toBe(false)
    })

    test('returns 404 when run belongs to another workspace', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const run = await createRun(trx, other.workspace.id)

      const res = await server(`/api/consolidation/runs/${run.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(404)
    })
  })

  describe('pOST /api/consolidation/runs/:id/restore', () => {
    test('returns 401 when unauthenticated', async ({ server, trx }) => {
      const { workspace } = await givenVerifiedUser()
      const run = await createRun(trx, workspace.id)

      const res = await server(`/api/consolidation/runs/${run.id}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    })

    test('restores the snapshot and re-mirrors the graph', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      await captureSnapshot(trx, run.id, workspace.id)

      // Mutate the graph after the snapshot.
      await trx.deleteFrom('concepts').where('id', '=', seeded.conceptB.id).execute()
      await trx.deleteFrom('mentions').where('concept_id', '=', seeded.conceptB.id).execute()
      await trx.deleteFrom('concept_topics').where('concept_id', '=', seeded.conceptB.id).execute()

      const res = await server(`/api/consolidation/runs/${run.id}/restore`, {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.restored).toBe(true)
      expect(body.counts.concepts).toBe(2)

      expect(await vertexCount(trx, workspace.id, 'Concept')).toBe(2)
      expect(await vertexCount(trx, workspace.id, 'Topic')).toBe(1)
    })

    test('returns 409 when a consolidation run is in progress for the workspace', async ({ server, db, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      await captureSnapshot(trx, run.id, workspace.id)

      // Simulate an in-flight consolidation run on another connection.
      const other = await db.startTransaction().execute()
      try {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))`.execute(other)

        const res = await server(`/api/consolidation/runs/${run.id}/restore`, {
          method: 'POST',
          headers: { 'cookie': cookies, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(409)
      }
      finally {
        await other.rollback().execute()
      }

      // Graph untouched by the rejected restore.
      const concepts = await trx
        .selectFrom('concepts')
        .select('name')
        .where('workspace_id', '=', workspace.id)
        .orderBy('name')
        .execute()
      expect(concepts.map(c => c.name)).toEqual(['Concept A', 'Concept B'])
    })

    test('returns 404 when the run has no snapshot', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const run = await createRun(trx, workspace.id)

      const res = await server(`/api/consolidation/runs/${run.id}/restore`, {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(404)
    })

    test('returns 404 when restore run belongs to another workspace', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const run = await createRun(trx, other.workspace.id)

      const res = await server(`/api/consolidation/runs/${run.id}/restore`, {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(404)
    })
  })
})
