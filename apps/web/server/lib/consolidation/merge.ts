import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { EmbeddingProvider } from '../ai/types'
import type { MergeVerdict } from './types'
import { sql } from 'kysely'
import { halfvecLiteral } from '../agent/vector'
import { topicEmbeddingInput } from '../pipeline/stages/store-graph'

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

export async function executeConceptMerge(
  db: ConsolidationDb,
  workspaceId: string,
  verdict: MergeVerdict,
  runId: string,
  embeddingProvider?: EmbeddingProvider,
): Promise<void> {
  const [id1, id2] = verdict.pairId.split('::')
  const loserId = id1 === verdict.survivorId ? id2! : id1!

  const [survivor, loser] = await Promise.all([
    db.selectFrom('concepts').selectAll().where('id', '=', verdict.survivorId).executeTakeFirstOrThrow(),
    db.selectFrom('concepts').selectAll().where('id', '=', loserId).executeTakeFirstOrThrow(),
  ])

  const descriptionChanged = verdict.mergedDescription && verdict.mergedDescription !== survivor.description
  if (descriptionChanged) {
    await db
      .updateTable('concepts')
      .set({ description: verdict.mergedDescription, updated_at: sql`now()` })
      .where('id', '=', survivor.id)
      .execute()
  }

  const loserMentions = await db
    .selectFrom('mentions')
    .select(['id', 'chunk_id'])
    .where('workspace_id', '=', workspaceId)
    .where('concept_id', '=', loser.id)
    .execute()

  for (const mention of loserMentions) {
    await db
      .insertInto('mentions')
      .values({
        workspace_id: workspaceId,
        chunk_id: mention.chunk_id,
        concept_id: survivor.id,
      })
      .onConflict(oc => oc.columns(['chunk_id', 'concept_id']).doNothing())
      .execute()
  }

  await db
    .deleteFrom('mentions')
    .where('workspace_id', '=', workspaceId)
    .where('concept_id', '=', loser.id)
    .execute()

  const loserRelations = await db
    .selectFrom('relations')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where(eb => eb.or([
      eb('from_concept_id', '=', loser.id),
      eb('to_concept_id', '=', loser.id),
    ]))
    .execute()

  for (const relation of loserRelations) {
    const fromId = relation.from_concept_id === loser.id ? survivor.id : relation.from_concept_id
    const toId = relation.to_concept_id === loser.id ? survivor.id : relation.to_concept_id

    if (fromId === toId) {
      await db.deleteFrom('relations').where('id', '=', relation.id).execute()
      continue
    }

    await db
      .insertInto('relations')
      .values({
        workspace_id: workspaceId,
        from_concept_id: fromId,
        to_concept_id: toId,
        type: relation.type,
        description: relation.description,
      })
      .execute()
  }

  await db
    .deleteFrom('relations')
    .where('workspace_id', '=', workspaceId)
    .where(eb => eb.or([
      eb('from_concept_id', '=', loser.id),
      eb('to_concept_id', '=', loser.id),
    ]))
    .execute()

  await dedupeRelations(db, workspaceId)

  const loserTopics = await db
    .selectFrom('concept_topics')
    .select('topic_id')
    .where('workspace_id', '=', workspaceId)
    .where('concept_id', '=', loser.id)
    .execute()

  for (const ct of loserTopics) {
    await db
      .insertInto('concept_topics')
      .values({
        workspace_id: workspaceId,
        concept_id: survivor.id,
        topic_id: ct.topic_id,
      })
      .onConflict(oc => oc.columns(['concept_id', 'topic_id']).doNothing())
      .execute()
  }

  await db
    .deleteFrom('concept_topics')
    .where('workspace_id', '=', workspaceId)
    .where('concept_id', '=', loser.id)
    .execute()

  await db
    .deleteFrom('concepts')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', loser.id)
    .execute()

  if (descriptionChanged && embeddingProvider) {
    await reembedConcept(db, embeddingProvider, survivor.id, survivor.name, verdict.mergedDescription!)
  }

  await db
    .insertInto('consolidation_run_changes')
    .values({
      run_id: runId,
      action: 'merge-concept',
      text: `${survivor.name} ← ${loser.name}`,
      reason: verdict.reason,
    })
    .execute()
}

export async function executeTopicMerge(
  db: ConsolidationDb,
  workspaceId: string,
  verdict: MergeVerdict,
  runId: string,
  embeddingProvider?: EmbeddingProvider,
): Promise<void> {
  const [id1, id2] = verdict.pairId.split('::')
  const loserId = id1 === verdict.survivorId ? id2! : id1!

  const [survivor, loser] = await Promise.all([
    db.selectFrom('topics').selectAll().where('id', '=', verdict.survivorId).executeTakeFirstOrThrow(),
    db.selectFrom('topics').selectAll().where('id', '=', loserId).executeTakeFirstOrThrow(),
  ])

  const descriptionChanged = verdict.mergedDescription && verdict.mergedDescription !== survivor.description
  if (descriptionChanged) {
    await db
      .updateTable('topics')
      .set({ description: verdict.mergedDescription, updated_at: sql`now()` })
      .where('id', '=', survivor.id)
      .execute()
  }

  const loserConcepts = await db
    .selectFrom('concept_topics')
    .select('concept_id')
    .where('workspace_id', '=', workspaceId)
    .where('topic_id', '=', loser.id)
    .execute()

  for (const ct of loserConcepts) {
    await db
      .insertInto('concept_topics')
      .values({
        workspace_id: workspaceId,
        concept_id: ct.concept_id,
        topic_id: survivor.id,
      })
      .onConflict(oc => oc.columns(['concept_id', 'topic_id']).doNothing())
      .execute()
  }

  await db
    .deleteFrom('concept_topics')
    .where('workspace_id', '=', workspaceId)
    .where('topic_id', '=', loser.id)
    .execute()

  await db
    .deleteFrom('topics')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', loser.id)
    .execute()

  if (descriptionChanged && embeddingProvider) {
    await reembedTopic(db, embeddingProvider, survivor.id, survivor.name, verdict.mergedDescription!)
  }

  await db
    .insertInto('consolidation_run_changes')
    .values({
      run_id: runId,
      action: 'merge-topic',
      text: `${survivor.name} ← ${loser.name}`,
      reason: verdict.reason,
    })
    .execute()
}

async function dedupeRelations(db: ConsolidationDb, workspaceId: string): Promise<void> {
  const allRelations = await db
    .selectFrom('relations')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .execute()

  const groups = new Map<string, typeof allRelations>()
  for (const relation of allRelations) {
    const key = `${relation.from_concept_id}:${relation.to_concept_id}:${relation.type}`
    const list = groups.get(key) ?? []
    list.push(relation)
    groups.set(key, list)
  }

  for (const list of groups.values()) {
    if (list.length <= 1)
      continue

    const preferred = list
      .filter(r => r.description && r.description.trim().length > 0)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
      ?? list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]

    const idsToDelete = list.filter(r => r.id !== preferred!.id).map(r => r.id)
    if (idsToDelete.length > 0) {
      await db
        .deleteFrom('relations')
        .where('id', 'in', idsToDelete)
        .execute()
    }
  }
}

async function reembedConcept(
  db: ConsolidationDb,
  provider: EmbeddingProvider,
  conceptId: string,
  name: string,
  description: string,
): Promise<void> {
  const embeddings = await provider.embed([`${name}: ${description}`])
  const embedding = embeddings[0]
  if (!embedding)
    throw new Error(`embedding provider returned no embedding for merged concept ${conceptId}`)

  await db
    .updateTable('concepts')
    .set({ embedding: halfvecLiteral(embedding) })
    .where('id', '=', conceptId)
    .execute()
}

async function reembedTopic(
  db: ConsolidationDb,
  provider: EmbeddingProvider,
  topicId: string,
  name: string,
  description: string,
): Promise<void> {
  const embeddings = await provider.embed([topicEmbeddingInput({ name, description })])
  const embedding = embeddings[0]
  if (!embedding)
    throw new Error(`embedding provider returned no embedding for merged topic ${topicId}`)

  await db
    .updateTable('topics')
    .set({ embedding: halfvecLiteral(embedding) })
    .where('id', '=', topicId)
    .execute()
}
