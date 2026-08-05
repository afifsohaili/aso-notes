import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { EmbeddingProvider } from '../ai/types'
import type { ConsolidationCounts, ConsolidationFlags, ConsolidationJudge, ConsolidationMetrics, ConsolidationRunResult, RunConsolidationOptions } from './types'
import { sql } from 'kysely'
import { remirrorGraph } from '../graph/remirror'
import { resolveConsolidationRunBudget } from '../settings'
import { makeDefaultJudge } from './judge'
import { executeConceptMerge, executeTopicMerge } from './merge'
import { computeFlags, computeMetrics } from './metrics'
import { cleanupTopics, executePruneConcept } from './prune'
import { batchJudge, buildMergePairs, buildPruneCandidates, loserIdFromVerdict } from './shortlist'
import { captureSnapshot } from './snapshot'
import { JUDGE_BATCH_SIZE } from './types'

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

export * from './types'

interface RunRow {
  id: string
}

export async function runConsolidation(
  db: ConsolidationDb,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  options: RunConsolidationOptions = {},
): Promise<ConsolidationRunResult> {
  const run = await createRun(db, workspaceId, mode)
  const now = options.now ?? new Date()

  try {
    await captureSnapshot(db, run.id, workspaceId)

    const metricsBefore = await computeMetrics(db, workspaceId)
    const counts: ConsolidationCounts = {
      merges: 0,
      prunes: 0,
      rewrites: 0,
      dissolves: 0,
      refiles: 0,
      judgeCalls: 0,
    }

    let judge: ConsolidationJudge
    let embeddingProvider: EmbeddingProvider | undefined
    if (options.judge) {
      judge = options.judge
      embeddingProvider = options.embeddingProvider
    }
    else {
      const resolved = await makeDefaultJudge(db, workspaceId)
      judge = resolved.judge
      embeddingProvider = resolved.embeddingProvider
    }

    const hwm = mode === 'incremental' ? await findLastSuccessfulHwm(db, workspaceId) : null
    const mergePairs = await buildMergePairs(db, workspaceId, mode, hwm)

    const budget = await resolveConsolidationRunBudget(db, workspaceId)
    const mergePairsToJudge = mergePairs.slice(0, budget)
    const pruneBudget = budget - mergePairsToJudge.length

    const { merges: mergeVerdicts, judgeCalls: mergeJudgeCalls } = await batchJudge(judge, mergePairsToJudge, [])
    counts.judgeCalls += mergeJudgeCalls

    const mergedIds = new Set<string>()
    for (const verdict of mergeVerdicts) {
      if (!verdict.merge)
        continue
      if (mergedIds.has(verdict.pairId))
        continue
      if (mergedIds.has(verdict.survivorId) || mergedIds.has(loserIdFromVerdict(verdict)))
        continue

      if (verdict.kind === 'concept')
        await executeConceptMerge(db, workspaceId, verdict, run.id, embeddingProvider)
      else
        await executeTopicMerge(db, workspaceId, verdict, run.id, embeddingProvider)

      mergedIds.add(verdict.pairId)
      mergedIds.add(verdict.survivorId)
      mergedIds.add(loserIdFromVerdict(verdict))
      counts.merges++
    }

    const pruneCandidates = pruneBudget > 0 ? await buildPruneCandidates(db, workspaceId, mergedIds, now) : []
    if (pruneBudget > 0) {
      const pruneCandidatesToJudge = pruneCandidates.slice(0, pruneBudget)
      const { prunes: pruneVerdicts, judgeCalls: pruneJudgeCalls } = await batchJudge(judge, [], pruneCandidatesToJudge)
      counts.judgeCalls += pruneJudgeCalls

      for (const verdict of pruneVerdicts) {
        if (!verdict.prune)
          continue
        if (mergedIds.has(verdict.id))
          continue

        if (verdict.kind === 'concept') {
          await executePruneConcept(db, workspaceId, verdict, run.id)
          counts.prunes++
        }
        mergedIds.add(verdict.id)
      }
    }

    await cleanupTopics(db, workspaceId, run.id, judge, counts, JUDGE_BATCH_SIZE)

    await remirrorGraph(db, workspaceId)

    const metricsAfter = await computeMetrics(db, workspaceId)
    const flags = await computeFlags(db, workspaceId, mode, metricsBefore, metricsAfter)

    await finalizeRun(db, run.id, metricsBefore, metricsAfter, flags, counts)

    return {
      runId: run.id,
      status: 'completed',
      metricsBefore,
      metricsAfter,
      flags,
      counts,
    }
  }
  catch (error) {
    await failRun(db, run.id, error)
    throw error
  }
}

async function createRun(db: ConsolidationDb, workspaceId: string, mode: 'full' | 'incremental' | 'manual'): Promise<RunRow> {
  return db
    .insertInto('consolidation_runs')
    .values({
      workspace_id: workspaceId,
      mode,
      status: 'running',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()
}

async function findLastSuccessfulHwm(db: ConsolidationDb, workspaceId: string): Promise<Date | null> {
  const run = await db
    .selectFrom('consolidation_runs')
    .select('finished_at')
    .where('workspace_id', '=', workspaceId)
    .where('status', '=', 'completed')
    .orderBy('finished_at', 'desc')
    .executeTakeFirst()

  return run?.finished_at ? new Date(run.finished_at) : null
}

async function finalizeRun(
  db: ConsolidationDb,
  runId: string,
  metricsBefore: ConsolidationMetrics,
  metricsAfter: ConsolidationMetrics,
  flags: ConsolidationFlags,
  counts: ConsolidationCounts,
): Promise<void> {
  await db
    .updateTable('consolidation_runs')
    .set({
      status: 'completed',
      finished_at: sql`now()`,
      metrics_before: JSON.parse(JSON.stringify(metricsBefore)),
      metrics_after: JSON.parse(JSON.stringify(metricsAfter)),
      flags: JSON.parse(JSON.stringify(flags)),
      counts: JSON.parse(JSON.stringify(counts)),
    })
    .where('id', '=', runId)
    .execute()
}

async function failRun(db: ConsolidationDb, runId: string, error: unknown): Promise<void> {
  await db
    .updateTable('consolidation_runs')
    .set({
      status: 'failed',
      finished_at: sql`now()`,
      error: error instanceof Error ? error.message : String(error),
    })
    .where('id', '=', runId)
    .execute()
}
