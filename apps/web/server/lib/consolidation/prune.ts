import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { ConsolidationCounts, ConsolidationJudge, PruneVerdict } from './types'
import { sql } from 'kysely'

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

export async function executePruneConcept(
  db: ConsolidationDb,
  workspaceId: string,
  verdict: PruneVerdict,
  runId: string,
): Promise<void> {
  const concept = await db
    .selectFrom('concepts')
    .select(['id', 'name'])
    .where('id', '=', verdict.id)
    .executeTakeFirstOrThrow()

  await db
    .deleteFrom('concepts')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', concept.id)
    .execute()

  await db
    .insertInto('consolidation_run_changes')
    .values({
      run_id: runId,
      action: 'prune',
      text: concept.name,
      reason: verdict.reason,
    })
    .execute()
}

export async function executePruneTopic(
  db: ConsolidationDb,
  workspaceId: string,
  verdict: PruneVerdict,
  runId: string,
): Promise<void> {
  const topic = await db
    .selectFrom('topics')
    .select(['id', 'name'])
    .where('id', '=', verdict.id)
    .executeTakeFirstOrThrow()

  await db
    .deleteFrom('topics')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', topic.id)
    .execute()

  await db
    .insertInto('consolidation_run_changes')
    .values({
      run_id: runId,
      action: 'dissolve',
      text: topic.name,
      reason: verdict.reason,
    })
    .execute()
}

export async function cleanupTopics(
  db: ConsolidationDb,
  workspaceId: string,
  runId: string,
  judge: ConsolidationJudge,
  counts: ConsolidationCounts,
  batchSize: number,
): Promise<void> {
  const emptyTopics = await db
    .selectFrom('topics')
    .leftJoin('concept_topics', join => join
      .onRef('concept_topics.topic_id', '=', 'topics.id')
      .on('concept_topics.workspace_id', '=', workspaceId))
    .select(['topics.id', 'topics.name'])
    .where('topics.workspace_id', '=', workspaceId)
    .where('concept_topics.concept_id', 'is', null)
    .execute()

  for (const topic of emptyTopics) {
    await db
      .deleteFrom('topics')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', topic.id)
      .execute()

    await db
      .insertInto('consolidation_run_changes')
      .values({
        run_id: runId,
        action: 'prune',
        text: topic.name,
        reason: 'empty topic after merges/prunes',
      })
      .execute()
    counts.prunes++
  }

  const singletonTopics = await db
    .selectFrom('topics')
    .innerJoin('concept_topics', join => join
      .onRef('concept_topics.topic_id', '=', 'topics.id')
      .on('concept_topics.workspace_id', '=', workspaceId))
    .select(['topics.id', 'topics.name', 'topics.description'])
    .select(sql<number>`count(*)::int`.as('concept_count'))
    .where('topics.workspace_id', '=', workspaceId)
    .groupBy(['topics.id', 'topics.name', 'topics.description'])
    .having(sql<number>`count(*)`, '=', 1)
    .execute()

  const dissolveCandidates = singletonTopics.map(t => ({
    kind: 'topic' as const,
    id: t.id,
    name: t.name,
    description: t.description,
    mentionCount: 0,
    relationCount: 0,
    sampleChunkText: null,
  }))

  for (let i = 0; i < dissolveCandidates.length; i += batchSize) {
    const batch = dissolveCandidates.slice(i, i + batchSize)
    const response = await judge({ mergePairs: [], pruneCandidates: batch })
    counts.judgeCalls++
    for (const verdict of response.prunes) {
      if (verdict.prune) {
        await executePruneTopic(db, workspaceId, verdict, runId)
        counts.dissolves++
      }
    }
  }
}
