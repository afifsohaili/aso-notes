import type { ConsolidationDb, ConsolidationFlags, ConsolidationMetrics } from './types'
import { sql } from 'kysely'
import { NEAR_DUPE_THRESHOLD } from './types'

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

/**
 * Set-based near-dupe pair rate: one self-join query counts pairs above the
 * cosine threshold (`<=>` is the pgvector cosine distance operator) instead of
 * one round-trip per pair.
 */
async function computeNearDupeRate(db: ConsolidationDb, workspaceId: string, conceptCount: number): Promise<number> {
  if (conceptCount < 2)
    return 0

  const result = await sql<{ near_dupes: number, total: number }>`
    SELECT
      count(*) FILTER (WHERE 1 - (a.embedding <=> b.embedding) > ${NEAR_DUPE_THRESHOLD})::int AS near_dupes,
      count(*)::int AS total
    FROM concepts a
    JOIN concepts b
      ON b.workspace_id = a.workspace_id
     AND a.id < b.id
    WHERE a.workspace_id = ${workspaceId}
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
  `.execute(db)

  const row = result.rows[0]
  const total = Number(row?.total ?? 0)
  return total ? Number(row!.near_dupes) / total : 0
}

/**
 * Orphan rate per spec (ticket-measuring-success): Concepts with zero
 * Relations on either side, regardless of Topic membership.
 */
async function computeOrphanRate(db: ConsolidationDb, workspaceId: string, conceptCount: number): Promise<number> {
  if (conceptCount === 0)
    return 0

  const result = await sql<{ c: number }>`
    SELECT count(*)::int AS c
    FROM concepts c
    WHERE c.workspace_id = ${workspaceId}
      AND NOT EXISTS (
        SELECT 1
        FROM relations r
        WHERE r.workspace_id = c.workspace_id
          AND (r.from_concept_id = c.id OR r.to_concept_id = c.id)
      )
  `.execute(db)

  return Number(result.rows[0]?.c ?? 0) / conceptCount
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
