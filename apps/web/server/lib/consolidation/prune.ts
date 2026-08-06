import type { ConsolidationCounts, ConsolidationDb, ConsolidationJudge, PruneVerdict } from './types'
import { batchJudge, buildSingletonTopicCandidates } from './shortlist'

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
    .where('workspace_id', '=', workspaceId)
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
    .where('workspace_id', '=', workspaceId)
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
  judgeBudget: number,
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

  // Singleton-topic dissolves are bounded by the run budget left over after
  // merge and prune judging; overflow defers to the next run.
  const singletonCandidates = await buildSingletonTopicCandidates(db, workspaceId)
  const dissolveCandidates = singletonCandidates.slice(0, Math.max(0, judgeBudget))

  const { prunes: dissolveVerdicts, judgeCalls, skippedInvalidVerdicts } = await batchJudge(judge, [], dissolveCandidates)
  counts.judgeCalls += judgeCalls
  counts.skippedInvalidVerdicts += skippedInvalidVerdicts

  for (const verdict of dissolveVerdicts) {
    if (verdict.prune) {
      await executePruneTopic(db, workspaceId, verdict, runId)
      counts.dissolves++
    }
  }
}
