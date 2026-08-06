import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { captureSnapshot, getSnapshot, listSnapshots, restoreSnapshot } from '../../server/lib/consolidation/snapshot'
import { parseAgtype, queryCypher } from '../../server/lib/graph/age'
import { ensureNotesGraphCatalog } from './age-catalog'

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

  const topicY = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Topic Y', name_normalized: 'topic y', description: 'y' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  await trx.insertInto('mentions').values([
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptA.id },
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptB.id },
  ]).execute()

  await trx.insertInto('relations').values({
    workspace_id: workspaceId,
    from_concept_id: conceptA.id,
    to_concept_id: conceptB.id,
    type: 'relates-to',
    description: '',
  }).execute()

  await trx.insertInto('concept_topics').values([
    { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicX.id },
    { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicY.id },
    { workspace_id: workspaceId, concept_id: conceptB.id, topic_id: topicX.id },
  ]).execute()

  return { note, chunk, conceptA, conceptB, topicX, topicY }
}

async function createRun(trx: any, workspaceId: string, mode = 'manual') {
  return trx
    .insertInto('consolidation_runs')
    .values({ workspace_id: workspaceId, mode, status: 'running' })
    .returning(['id'])
    .executeTakeFirstOrThrow()
}

async function vertexCount(trx: any, workspaceId: string, label: string): Promise<number> {
  const rows = await queryCypher<{ n: unknown }>(
    trx,
    `MATCH (n:${label} {workspace_id: '${workspaceId}'}) RETURN count(n) AS n`,
    'n ag_catalog.agtype',
  )
  return Number(rows[0]!.n)
}

async function edgeCount(trx: any, workspaceId: string, type: string): Promise<number> {
  const rows = await queryCypher<{ n: unknown }>(
    trx,
    `MATCH ()-[r:${type} {workspace_id: '${workspaceId}'}]->() RETURN count(r) AS n`,
    'n ag_catalog.agtype',
  )
  return Number(rows[0]!.n)
}

describe('consolidation snapshot service', () => {
  describe('captureSnapshot', () => {
    test('captures a self-contained payload of the five graph tables', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)

      const result = await captureSnapshot(trx, run.id, workspace.id)

      expect(result.counts).toEqual({
        concepts: 2,
        topics: 2,
        conceptTopics: 3,
        relations: 1,
        mentions: 2,
      })

      const row = await trx
        .selectFrom('consolidation_snapshots')
        .selectAll()
        .where('id', '=', result.snapshotId)
        .executeTakeFirstOrThrow()

      expect(row.run_id).toBe(run.id)
      expect(row.workspace_id).toBe(workspace.id)
      const payload = row.payload as any
      expect(payload.concepts).toHaveLength(2)
      expect(payload.topics).toHaveLength(2)
      expect(payload.concept_topics).toHaveLength(3)
      expect(payload.relations).toHaveLength(1)
      expect(payload.mentions).toHaveLength(2)
      expect(payload.captured_at).toBeDefined()
      expect(payload.concepts.map((c: any) => c.id)).toEqual(
        expect.arrayContaining([seeded.conceptA.id, seeded.conceptB.id]),
      )
      expect(payload.concept_topics.map((ct: any) => ct.concept_id)).toEqual(
        expect.arrayContaining([seeded.conceptA.id, seeded.conceptB.id]),
      )
    })
  })

  describe('restoreSnapshot', () => {
    test('restores the five graph tables and re-mirrors AGE', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      // Mutate: rename a concept, delete a topic, add a new concept/topic/relation.
      await trx
        .updateTable('concepts')
        .set({ name: 'Renamed A', name_normalized: 'renamed a' })
        .where('id', '=', seeded.conceptA.id)
        .execute()

      await trx.deleteFrom('topics').where('id', '=', seeded.topicY.id).execute()
      await trx.deleteFrom('concept_topics').where('topic_id', '=', seeded.topicY.id).execute()

      const topicZ = await trx
        .insertInto('topics')
        .values({ workspace_id: workspace.id, name: 'Topic Z', name_normalized: 'topic z', description: 'z' })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      const conceptC = await trx
        .insertInto('concepts')
        .values({ workspace_id: workspace.id, name: 'Concept C', name_normalized: 'concept c', description: 'c' })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      await trx.insertInto('concept_topics').values({
        workspace_id: workspace.id,
        concept_id: conceptC.id,
        topic_id: topicZ.id,
      }).execute()

      const result = await restoreSnapshot(trx, snapshotId, workspace.id)

      expect(result.counts).toEqual({
        concepts: 2,
        topics: 2,
        conceptTopics: 3,
        relations: 1,
        mentions: 2,
      })
      expect(result.remirror).toEqual({
        concepts: 2,
        topics: 2,
        noteVertices: 1,
        mentions: 2,
        relations: 1,
        conceptTopics: 3,
      })

      const concepts = await trx.selectFrom('concepts').selectAll().where('workspace_id', '=', workspace.id).execute()
      const topics = await trx.selectFrom('topics').selectAll().where('workspace_id', '=', workspace.id).execute()
      const conceptTopics = await trx.selectFrom('concept_topics').selectAll().where('workspace_id', '=', workspace.id).execute()
      const relations = await trx.selectFrom('relations').selectAll().where('workspace_id', '=', workspace.id).execute()
      const mentions = await trx.selectFrom('mentions').selectAll().where('workspace_id', '=', workspace.id).execute()

      expect(concepts.map(c => c.name).sort()).toEqual(['Concept A', 'Concept B'])
      expect(topics.map(t => t.name).sort()).toEqual(['Topic X', 'Topic Y'])
      expect(conceptTopics).toHaveLength(3)
      expect(relations).toHaveLength(1)
      expect(mentions).toHaveLength(2)

      expect(await vertexCount(trx, workspace.id, 'Concept')).toBe(2)
      expect(await vertexCount(trx, workspace.id, 'Topic')).toBe(2)
      expect(await vertexCount(trx, workspace.id, 'Note')).toBe(1)
      expect(await edgeCount(trx, workspace.id, 'MENTIONS')).toBe(2)
      expect(await edgeCount(trx, workspace.id, 'RELATES_TO')).toBe(1)
      expect(await edgeCount(trx, workspace.id, 'GROUPED_UNDER')).toBe(3)

      const conceptAName = await queryCypher<{ name: unknown }>(
        trx,
        `MATCH (n:Concept {id: '${seeded.conceptA.id}'}) RETURN n.name AS name`,
        'name ag_catalog.agtype',
      )
      expect(parseAgtype(conceptAName[0]!.name)).toBe('Concept A')
    })

    test('resets post-snapshot ingested notes to pending and leaves older notes alone', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      // Older ingested note: keep ingested.
      const olderNote = await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: seeded.note.synced_folder_id,
          path: '/older.md',
          title: 'Older',
          content: 'older',
          content_hash: 'older-hash',
          status: 'ingested',
          created_at: new Date('2020-01-01T00:00:00Z'),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      // Newer ingested note: reset to pending.
      const newerNote = await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: seeded.note.synced_folder_id,
          path: '/newer.md',
          title: 'Newer',
          content: 'newer',
          content_hash: 'newer-hash',
          status: 'ingested',
          created_at: new Date('2099-01-01T00:00:00Z'),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      const result = await restoreSnapshot(trx, snapshotId, workspace.id)
      expect(result.notesReset).toBe(1)

      const older = await trx.selectFrom('notes').select('status').where('id', '=', olderNote.id).executeTakeFirstOrThrow()
      const newer = await trx.selectFrom('notes').select('status').where('id', '=', newerNote.id).executeTakeFirstOrThrow()
      expect(older.status).toBe('ingested')
      expect(newer.status).toBe('pending')
    })

    test('resets a note created before the snapshot but ingested after it', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      // Note row existed before the snapshot (created long ago) but its
      // Ingestion only completed afterwards — its mentions/concepts postdate
      // the snapshot and must be re-extracted on restore.
      const lateIngestedNote = await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: seeded.note.synced_folder_id,
          path: '/late.md',
          title: 'Late',
          content: 'late',
          content_hash: 'late-hash',
          status: 'pending',
          created_at: new Date('2020-01-01T00:00:00Z'),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      await trx
        .updateTable('notes')
        .set({ status: 'ingested', ingested_at: new Date('2099-01-01T00:00:00Z') })
        .where('id', '=', lateIngestedNote.id)
        .execute()

      const result = await restoreSnapshot(trx, snapshotId, workspace.id)
      expect(result.notesReset).toBe(1)

      const note = await trx.selectFrom('notes').select('status').where('id', '=', lateIngestedNote.id).executeTakeFirstOrThrow()
      expect(note.status).toBe('pending')
    })

    test('rolls back all table changes when the restore fails mid-way', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const seeded = await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      // Post-snapshot mutation: delete topic Y and its concept_topics rows.
      await trx.deleteFrom('concept_topics').where('topic_id', '=', seeded.topicY.id).execute()
      await trx.deleteFrom('topics').where('id', '=', seeded.topicY.id).execute()

      // Corrupt the snapshot payload so a row violates NOT NULL on insert.
      const row = await trx
        .selectFrom('consolidation_snapshots')
        .select('payload')
        .where('id', '=', snapshotId)
        .executeTakeFirstOrThrow()
      const corrupted = JSON.parse(JSON.stringify(row.payload)) as any
      corrupted.concepts[0].name = null
      await trx
        .updateTable('consolidation_snapshots')
        .set({ payload: corrupted })
        .where('id', '=', snapshotId)
        .execute()

      await expect(restoreSnapshot(trx, snapshotId, workspace.id)).rejects.toThrow()

      // The relational delete+insert must roll back: tables look exactly as
      // they did before the failed restore attempt (topic Y deleted, the rest intact).
      const concepts = await trx.selectFrom('concepts').select('name').where('workspace_id', '=', workspace.id).orderBy('name').execute()
      const topics = await trx.selectFrom('topics').select('name').where('workspace_id', '=', workspace.id).execute()
      const conceptTopics = await trx.selectFrom('concept_topics').selectAll().where('workspace_id', '=', workspace.id).execute()
      const relations = await trx.selectFrom('relations').selectAll().where('workspace_id', '=', workspace.id).execute()
      const mentions = await trx.selectFrom('mentions').selectAll().where('workspace_id', '=', workspace.id).execute()

      expect(concepts.map(c => c.name)).toEqual(['Concept A', 'Concept B'])
      expect(topics.map(t => t.name)).toEqual(['Topic X'])
      expect(conceptTopics).toHaveLength(2)
      expect(relations).toHaveLength(1)
      expect(mentions).toHaveLength(2)
    })
  })

  describe('captureSnapshot retention', () => {
    test('prunes snapshots beyond 10 per workspace, oldest first', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      const runIds: string[] = []
      for (let i = 0; i < 11; i++) {
        const run = await trx
          .insertInto('consolidation_runs')
          .values({
            workspace_id: workspace.id,
            mode: 'manual',
            status: 'running',
            created_at: new Date(`2020-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
          })
          .returning(['id'])
          .executeTakeFirstOrThrow()
        runIds.push(run.id)
        await captureSnapshot(trx, run.id, workspace.id)
      }

      // Other-workspace run should be untouched by retention.
      const otherRun = await createRun(trx, other.workspace.id)
      await captureSnapshot(trx, otherRun.id, other.workspace.id)

      const newRun = await createRun(trx, workspace.id)
      await captureSnapshot(trx, newRun.id, workspace.id)

      const remainingRuns = await trx
        .selectFrom('consolidation_runs')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .orderBy('created_at', 'asc')
        .execute()

      expect(remainingRuns).toHaveLength(10)
      expect(remainingRuns.map(r => r.id)).not.toContain(runIds[0])
      expect(remainingRuns.map(r => r.id)).toContain(runIds[10])
      expect(remainingRuns.map(r => r.id)).toContain(newRun.id)

      const remainingSnapshots = await trx
        .selectFrom('consolidation_snapshots')
        .select('run_id')
        .where('workspace_id', '=', workspace.id)
        .execute()
      expect(remainingSnapshots).toHaveLength(10)
      expect(remainingSnapshots.map(s => s.run_id)).not.toContain(runIds[0])

      const otherRuns = await trx
        .selectFrom('consolidation_runs')
        .select('id')
        .where('workspace_id', '=', other.workspace.id)
        .execute()
      expect(otherRuns).toHaveLength(1)
    })
  })

  describe('workspace isolation', () => {
    test('restore rejects a snapshotId from another workspace', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      await seedGraph(trx, other.workspace.id)
      const otherRun = await createRun(trx, other.workspace.id)
      const { snapshotId } = await captureSnapshot(trx, otherRun.id, other.workspace.id)

      await expect(restoreSnapshot(trx, snapshotId, workspace.id))
        .rejects
        .toThrow('Snapshot not found')

      // Other workspace graph still intact.
      const otherConcepts = await trx
        .selectFrom('concepts')
        .select('name')
        .where('workspace_id', '=', other.workspace.id)
        .execute()
      expect(otherConcepts.map(c => c.name)).toContain('Concept A')
    })
  })

  describe('snapshot helpers', () => {
    test('listSnapshots and getSnapshot scope by workspace', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      const otherRun = await createRun(trx, other.workspace.id)
      const otherSnapshot = await captureSnapshot(trx, otherRun.id, other.workspace.id)

      const list = await listSnapshots(trx, workspace.id)
      expect(list).toHaveLength(1)
      expect(list[0]!.id).toBe(snapshotId)

      const got = await getSnapshot(trx, snapshotId, workspace.id)
      expect(got).toBeDefined()
      expect(got!.id).toBe(snapshotId)

      const wrongWorkspace = await getSnapshot(trx, otherSnapshot.snapshotId, workspace.id)
      expect(wrongWorkspace).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    test('capture and restore an empty workspace', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      const run = await createRun(trx, workspace.id)
      const { snapshotId, counts } = await captureSnapshot(trx, run.id, workspace.id)
      expect(counts).toEqual({
        concepts: 0,
        topics: 0,
        conceptTopics: 0,
        relations: 0,
        mentions: 0,
      })

      const result = await restoreSnapshot(trx, snapshotId, workspace.id)
      expect(result.notesReset).toBe(0)
      expect(result.remirror.concepts).toBe(0)
    })

    test('restore with zero post-snapshot ingested notes', async ({ trx }) => {
      const { workspace } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      await seedGraph(trx, workspace.id)
      const run = await createRun(trx, workspace.id)
      const { snapshotId } = await captureSnapshot(trx, run.id, workspace.id)

      const result = await restoreSnapshot(trx, snapshotId, workspace.id)
      expect(result.notesReset).toBe(0)
    })
  })
})
