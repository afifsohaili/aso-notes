import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { RemirrorCounts } from '../graph/remirror'
import { remirrorGraph } from '../graph/remirror'

export type SnapshotDb = Kysely<DB> | Transaction<DB>

interface SnapshotConcept {
  id: string
  workspace_id: string
  name: string
  name_normalized: string
  description: string | null
  embedding: string | null
  created_at: string
  updated_at: string
}

interface SnapshotTopic {
  id: string
  workspace_id: string
  name: string
  name_normalized: string
  description: string | null
  embedding: string | null
  created_at: string
  updated_at: string
}

interface SnapshotConceptTopic {
  workspace_id: string
  concept_id: string
  topic_id: string
}

interface SnapshotRelation {
  id: string
  workspace_id: string
  from_concept_id: string
  to_concept_id: string
  type: string
  description: string | null
  created_at: string
  updated_at: string
}

interface SnapshotMention {
  id: string
  workspace_id: string
  chunk_id: string
  concept_id: string
}

export interface SnapshotPayload {
  concepts: SnapshotConcept[]
  topics: SnapshotTopic[]
  concept_topics: SnapshotConceptTopic[]
  relations: SnapshotRelation[]
  mentions: SnapshotMention[]
  captured_at: string
}

export interface SnapshotCounts {
  concepts: number
  topics: number
  conceptTopics: number
  relations: number
  mentions: number
}

export interface CaptureResult {
  snapshotId: string
  counts: SnapshotCounts
}

export interface RestoreResult {
  counts: SnapshotCounts
  remirror: RemirrorCounts
  notesReset: number
}

const SNAPSHOT_RETENTION = 10

/**
 * Capture a point-in-time JSONB snapshot of the five consolidation-scoped
 * graph tables for a workspace, attached to the supplied run.
 *
 * Retention is enforced at the run level: after capturing, the oldest runs
 * beyond 10 for the workspace are deleted. Because snapshots and change rows
 * cascade on run delete, this keeps run history and snapshots consistent.
 */
export async function captureSnapshot(db: SnapshotDb, runId: string, workspaceId: string): Promise<CaptureResult> {
  const [concepts, topics, conceptTopics, relations, mentions] = await Promise.all([
    db.selectFrom('concepts').selectAll().where('workspace_id', '=', workspaceId).execute(),
    db.selectFrom('topics').selectAll().where('workspace_id', '=', workspaceId).execute(),
    db.selectFrom('concept_topics').selectAll().where('workspace_id', '=', workspaceId).execute(),
    db.selectFrom('relations').selectAll().where('workspace_id', '=', workspaceId).execute(),
    db.selectFrom('mentions').selectAll().where('workspace_id', '=', workspaceId).execute(),
  ])

  const capturedAt = new Date().toISOString()
  const payload: SnapshotPayload = {
    concepts: concepts as SnapshotConcept[],
    topics: topics as SnapshotTopic[],
    concept_topics: conceptTopics as SnapshotConceptTopic[],
    relations: relations as SnapshotRelation[],
    mentions: mentions as SnapshotMention[],
    captured_at: capturedAt,
  }

  const snapshot = await db
    .insertInto('consolidation_snapshots')
    .values({
      run_id: runId,
      workspace_id: workspaceId,
      payload,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  await pruneOldSnapshots(db, workspaceId)

  return {
    snapshotId: snapshot.id,
    counts: {
      concepts: concepts.length,
      topics: topics.length,
      conceptTopics: conceptTopics.length,
      relations: relations.length,
      mentions: mentions.length,
    },
  }
}

async function pruneOldSnapshots(db: SnapshotDb, workspaceId: string): Promise<void> {
  const runsToPrune = await db
    .selectFrom('consolidation_runs')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .offset(SNAPSHOT_RETENTION)
    .execute()

  for (const run of runsToPrune) {
    await db.deleteFrom('consolidation_runs').where('id', '=', run.id).execute()
  }
}

/**
 * Restore a workspace's five graph tables from a captured snapshot, re-mirror
 * AGE, and reset Notes ingested after the snapshot to pending so they re-extract
 * against the restored vocabulary.
 *
 * Authorization: the snapshot must belong to the supplied workspaceId. Never
 * trust a snapshotId alone.
 */
export async function restoreSnapshot(db: SnapshotDb, snapshotId: string, workspaceId: string): Promise<RestoreResult> {
  const snapshot = await db
    .selectFrom('consolidation_snapshots')
    .select(['id', 'run_id', 'workspace_id', 'payload'])
    .where('id', '=', snapshotId)
    .executeTakeFirst()

  if (!snapshot || snapshot.workspace_id !== workspaceId)
    throw new Error('Snapshot not found')

  const payload = snapshot.payload as SnapshotPayload
  const capturedAt = new Date(payload.captured_at)

  // Delete child rows first to respect FKs, then parent rows.
  await db.deleteFrom('mentions').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('relations').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('concept_topics').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('concepts').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('topics').where('workspace_id', '=', workspaceId).execute()

  for (const concept of payload.concepts) {
    await db.insertInto('concepts').values({
      id: concept.id,
      workspace_id: workspaceId,
      name: concept.name,
      name_normalized: concept.name_normalized,
      description: concept.description,
      embedding: concept.embedding,
      created_at: concept.created_at,
      updated_at: concept.updated_at,
    }).execute()
  }

  for (const topic of payload.topics) {
    await db.insertInto('topics').values({
      id: topic.id,
      workspace_id: workspaceId,
      name: topic.name,
      name_normalized: topic.name_normalized,
      description: topic.description,
      embedding: topic.embedding,
      created_at: topic.created_at,
      updated_at: topic.updated_at,
    }).execute()
  }

  for (const ct of payload.concept_topics) {
    await db.insertInto('concept_topics').values({
      workspace_id: workspaceId,
      concept_id: ct.concept_id,
      topic_id: ct.topic_id,
    }).execute()
  }

  for (const relation of payload.relations) {
    await db.insertInto('relations').values({
      id: relation.id,
      workspace_id: workspaceId,
      from_concept_id: relation.from_concept_id,
      to_concept_id: relation.to_concept_id,
      type: relation.type,
      description: relation.description,
      created_at: relation.created_at,
      updated_at: relation.updated_at,
    }).execute()
  }

  for (const mention of payload.mentions) {
    await db.insertInto('mentions').values({
      id: mention.id,
      workspace_id: workspaceId,
      chunk_id: mention.chunk_id,
      concept_id: mention.concept_id,
    }).execute()
  }

  const remirror = await remirrorGraph(db, workspaceId)

  const notesResetResult = await db
    .updateTable('notes')
    .set({ status: 'pending' })
    .where('workspace_id', '=', workspaceId)
    .where('status', '=', 'ingested')
    .where('created_at', '>', capturedAt)
    .executeTakeFirstOrThrow()

  return {
    counts: {
      concepts: payload.concepts.length,
      topics: payload.topics.length,
      conceptTopics: payload.concept_topics.length,
      relations: payload.relations.length,
      mentions: payload.mentions.length,
    },
    remirror,
    notesReset: Number(notesResetResult.numUpdatedRows ?? 0),
  }
}

export async function listSnapshots(db: SnapshotDb, workspaceId: string) {
  return db
    .selectFrom('consolidation_snapshots')
    .select(['id', 'run_id', 'workspace_id', 'payload', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function getSnapshot(db: SnapshotDb, snapshotId: string, workspaceId: string) {
  return db
    .selectFrom('consolidation_snapshots')
    .select(['id', 'run_id', 'workspace_id', 'payload', 'created_at'])
    .where('id', '=', snapshotId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()
}
