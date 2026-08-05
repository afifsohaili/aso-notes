import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { ConsolidationFlags, ConsolidationMetrics } from './types'
import { sql } from 'kysely'
import { NEAR_DUPE_THRESHOLD } from './types'

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

export async function computeMetrics(db: ConsolidationDb, workspaceId: string): Promise<ConsolidationMetrics> {
  const conceptsResult = await db
    .selectFrom('concepts')
    .select(sql<number>`count(*)::int`.as('c'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirstOrThrow()

  const topicsResult = await db
    .selectFrom('topics')
    .select(sql<number>`count(*)::int`.as('c'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirstOrThrow()

  const notesResult = await db
    .selectFrom('notes')
    .select(sql<number>`count(*)::int`.as('c'))
    .where('workspace_id', '=', workspaceId)
    .where('status', '=', 'ingested')
    .executeTakeFirstOrThrow()

  const concepts = Number(conceptsResult.c)
  const topics = Number(topicsResult.c)
  const notes = Number(notesResult.c)

  const [nearDupeRate, orphanRate, topicSpread] = await Promise.all([
    computeNearDupeRate(db, workspaceId, concepts),
    computeOrphanRate(db, workspaceId, concepts),
    computeTopicSpread(db, workspaceId, topics),
  ])

  return {
    concepts,
    topics,
    nearDupeRate,
    orphanRate,
    conceptsPerNote: notes ? concepts / notes : 0,
    topicSpread,
  }
}

async function computeNearDupeRate(db: ConsolidationDb, workspaceId: string, conceptCount: number): Promise<number> {
  if (conceptCount < 2)
    return 0

  const concepts = await db
    .selectFrom('concepts')
    .select(['id', 'embedding'])
    .where('workspace_id', '=', workspaceId)
    .where('embedding', 'is not', null)
    .execute()

  let nearDupePairs = 0
  let totalPairs = 0

  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      totalPairs++
      const distance = await db
        .selectFrom('concepts')
        .select(sql<number>`embedding <=> (SELECT embedding FROM concepts WHERE id = ${concepts[j]!.id})`.as('d'))
        .where('id', '=', concepts[i]!.id)
        .executeTakeFirstOrThrow()
      if (1 - Number(distance.d) > NEAR_DUPE_THRESHOLD)
        nearDupePairs++
    }
  }

  return totalPairs ? nearDupePairs / totalPairs : 0
}

async function computeOrphanRate(db: ConsolidationDb, workspaceId: string, conceptCount: number): Promise<number> {
  if (conceptCount === 0)
    return 0

  const orphans = await db
    .selectFrom('concepts')
    .leftJoin('concept_topics', join => join
      .onRef('concept_topics.concept_id', '=', 'concepts.id')
      .on('concept_topics.workspace_id', '=', workspaceId))
    .select(sql<number>`count(distinct concepts.id)::int`.as('c'))
    .where('concepts.workspace_id', '=', workspaceId)
    .where('concept_topics.topic_id', 'is', null)
    .executeTakeFirstOrThrow()

  return Number(orphans.c) / conceptCount
}

async function computeTopicSpread(db: ConsolidationDb, workspaceId: string, topicCount: number): Promise<number> {
  if (topicCount === 0)
    return 0

  const sizes = await db
    .selectFrom('topics')
    .leftJoin('concept_topics', join => join
      .onRef('concept_topics.topic_id', '=', 'topics.id')
      .on('concept_topics.workspace_id', '=', workspaceId))
    .select(['topics.id'])
    .select(sql<number>`count(concept_topics.concept_id)::int`.as('c'))
    .where('topics.workspace_id', '=', workspaceId)
    .groupBy('topics.id')
    .execute()

  const counts = sizes.map(s => Number(s.c))
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const variance = counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length
  return Math.sqrt(variance)
}

export async function computeFlags(
  db: ConsolidationDb,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  metricsBefore: ConsolidationMetrics,
  metricsAfter: ConsolidationMetrics,
): Promise<ConsolidationFlags> {
  const overPruning = metricsBefore.concepts > 0
    && (metricsBefore.concepts - metricsAfter.concepts) / metricsBefore.concepts > 0.2

  let ineffectiveness = false
  if ((mode === 'full' || mode === 'manual') && metricsAfter.concepts > 0) {
    const runs = await db
      .selectFrom('consolidation_runs')
      .select('metrics_after')
      .where('workspace_id', '=', workspaceId)
      .where('status', '=', 'completed')
      .where('mode', 'in', ['full', 'manual'])
      .orderBy('finished_at', 'desc')
      .limit(2)
      .execute()

    const rates = runs
      .map(r => (r.metrics_after as ConsolidationMetrics | null)?.nearDupeRate)
      .filter((r): r is number => typeof r === 'number')

    const lastThree = [metricsAfter.nearDupeRate, ...rates]
    if (lastThree.length >= 3) {
      ineffectiveness = lastThree[0]! >= lastThree[1]! && lastThree[1]! >= lastThree[2]!
    }
  }

  return { overPruning, ineffectiveness }
}
