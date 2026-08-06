import type { EmbeddingProvider } from '../ai/types'
import type { ConsolidationCounts, ConsolidationDb, ConsolidationFlags, ConsolidationJudge, ConsolidationMetrics, ConsolidationRunResult, RunConsolidationOptions } from './types'
import { sql } from 'kysely'
import { remirrorGraph } from '../graph/remirror'
import { resolveConsolidationRunBudget } from '../settings'
import { makeDefaultJudge } from './judge'
import { acquireConsolidationLock, ConsolidationLockConflictError } from './lock'
import { executeConceptMerge, executeTopicMerge } from './merge'
import { computeFlags, computeMetrics } from './metrics'
import { cleanupTopics, executePruneConcept } from './prune'
import { batchJudge, buildMergePairs, buildPruneCandidates, loserIdFromVerdict } from './shortlist'
import { captureSnapshot } from './snapshot'

export * from './types'

interface RunRow {
  id: string
}

/**
 * Run one consolidation sweep for a workspace.
 *
 * Concurrency: the whole run is guarded by a per-workspace Postgres advisory
 * lock (`acquireConsolidationLock`), so at most one consolidation mutation
 * (run or restore) is in flight per workspace. A concurrent attempt throws
 * ConsolidationLockConflictError — the API maps it to 409 and the cron worker
 * skips the workspace quietly (the next scheduled sweep picks it up).
 *
 * When called with a pooled Kysely (production), the run body executes in a
 * single transaction: mutations are atomic, the run row is created up-front
 * (and marked failed on error, or removed when the run never started due to a
 * lock conflict). When called with an existing transaction (test harness),
 * everything runs inside the host transaction.
 */
export async function runConsolidation(
  db: ConsolidationDb,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  options: RunConsolidationOptions = {},
): Promise<ConsolidationRunResult> {
  if (db.isTransaction) {
    await acquireConsolidationLock(db, workspaceId)
    const run = await createRun(db, workspaceId, mode)
    try {
      return await runConsolidationBody(db, run.id, workspaceId, mode, options)
    }
    catch (error) {
      await failRun(db, run.id, error)
      throw error
    }
  }

  const run = await createRun(db, workspaceId, mode)
  try {
    return await db.transaction().execute(async (trx) => {
      await acquireConsolidationLock(trx, workspaceId)
      return await runConsolidationBody(trx, run.id, workspaceId, mode, options)
    })
  }
  catch (error) {
    if (error instanceof ConsolidationLockConflictError) {
      // The run never started — don't leave a phantom 'running' row behind.
      await db.deleteFrom('consolidation_runs').where('id', '=', run.id).execute()
    }
    else {
      await failRun(db, run.id, error)
    }
    throw error
  }
}

async function runConsolidationBody(
  db: ConsolidationDb,
  runId: string,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  options: RunConsolidationOptions,
): Promise<ConsolidationRunResult> {
  const now = options.now ?? new Date()

  await captureSnapshot(db, runId, workspaceId)

  const metricsBefore = await computeMetrics(db, workspaceId)
  const counts: ConsolidationCounts = {
    merges: 0,
    prunes: 0,
    rewrites: 0,
    dissolves: 0,
    refiles: 0,
    judgeCalls: 0,
    skippedInvalidVerdicts: 0,
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

  const { merges: mergeVerdicts, judgeCalls: mergeJudgeCalls, skippedInvalidVerdicts: mergeSkipped } = await batchJudge(judge, mergePairsToJudge, [])
  counts.judgeCalls += mergeJudgeCalls
  counts.skippedInvalidVerdicts += mergeSkipped

  const mergedIds = new Set<string>()
  for (const verdict of mergeVerdicts) {
    if (!verdict.merge)
      continue
    if (mergedIds.has(verdict.pairId))
      continue
    if (mergedIds.has(verdict.survivorId) || mergedIds.has(loserIdFromVerdict(verdict)))
      continue

    if (verdict.kind === 'concept')
      await executeConceptMerge(db, workspaceId, verdict, runId, embeddingProvider)
    else
      await executeTopicMerge(db, workspaceId, verdict, runId, embeddingProvider)

    mergedIds.add(verdict.pairId)
    mergedIds.add(verdict.survivorId)
    mergedIds.add(loserIdFromVerdict(verdict))
    counts.merges++
  }

  const pruneCandidates = pruneBudget > 0 ? await buildPruneCandidates(db, workspaceId, mergedIds, now) : []
  const pruneCandidatesToJudge = pruneCandidates.slice(0, Math.max(0, pruneBudget))
  const { prunes: pruneVerdicts, judgeCalls: pruneJudgeCalls, skippedInvalidVerdicts: pruneSkipped } = await batchJudge(judge, [], pruneCandidatesToJudge)
  counts.judgeCalls += pruneJudgeCalls
  counts.skippedInvalidVerdicts += pruneSkipped

  for (const verdict of pruneVerdicts) {
    if (!verdict.prune)
      continue
    if (mergedIds.has(verdict.id))
      continue

    if (verdict.kind === 'concept') {
      await executePruneConcept(db, workspaceId, verdict, runId)
      counts.prunes++
    }
    mergedIds.add(verdict.id)
  }

  const cleanupBudget = Math.max(0, budget - mergePairsToJudge.length - pruneCandidatesToJudge.length)
  await cleanupTopics(db, workspaceId, runId, judge, counts, cleanupBudget)

  await remirrorGraph(db, workspaceId)

  const metricsAfter = await computeMetrics(db, workspaceId)
  const flags = await computeFlags(db, workspaceId, mode, metricsBefore, metricsAfter)

  await finalizeRun(db, runId, metricsBefore, metricsAfter, flags, counts)

  return {
    runId,
    status: 'completed',
    metricsBefore,
    metricsAfter,
    flags,
    counts,
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
