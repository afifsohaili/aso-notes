import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import { resolveContentRetentionDays } from '../settings'

export type ContentOwnerType = 'notes' | 'conversations' | 'consolidation_runs'
function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
}

interface TraceRef {
  id: string
  workspace_id: string
}

async function findTracesByOwner(
  db: Kysely<Database>,
  workspaceId: string,
  ownerType: string,
  ownerId: string,
): Promise<TraceRef[]> {
  return db
    .selectFrom('llm_traces')
    .select(['id', 'workspace_id'])
    .where('workspace_id', '=', workspaceId)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .execute()
}

async function pruneContentForTraceIds(
  db: Kysely<Database>,
  traceIds: string[],
  prunedAt: Date,
): Promise<number> {
  if (traceIds.length === 0)
    return 0

  // Skip in-flight (running) traces: pruning their content mid-flight could
  // race with generations/tool calls still being written by the pipeline.
  const settledTraceIds = await db
    .selectFrom('llm_traces')
    .select('id')
    .where('id', 'in', traceIds)
    .where('status', '!=', 'running')
    .execute()
  if (settledTraceIds.length === 0)
    return 0
  const ids = settledTraceIds.map(t => t.id)

  const [genResult, toolResult] = await Promise.all([
    db
      .updateTable('llm_generations')
      .set({ prompt: null, response: null, pruned_at: prunedAt })
      .where('trace_id', 'in', ids)
      .where('pruned_at', 'is', null)
      .executeTakeFirstOrThrow(),
    db
      .updateTable('llm_tool_calls')
      .set({ output: null, pruned_at: prunedAt })
      .where('trace_id', 'in', ids)
      .where('pruned_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ])

  return Number(genResult.numUpdatedRows ?? 0) + Number(toolResult.numUpdatedRows ?? 0)
}

/**
 * Immediately purge content columns for every trace belonging to a deleted
 * owner. Metadata (tokens, cost, model, latency, status) is kept forever. Rows
 * are never deleted. Safe to call before or after the owner row is removed
 * because the polymorphic owner lookup uses the trace's owner_type/owner_id
 * scoped to the workspace.
 */
export async function purgeTraceContentForOwner(
  db: Kysely<Database>,
  workspaceId: string,
  ownerType: ContentOwnerType,
  ownerId: string,
): Promise<void> {
  const traces = await findTracesByOwner(db, workspaceId, ownerType, ownerId)
  if (traces.length === 0)
    return

  const traceIds = traces.map(t => t.id)
  await pruneContentForTraceIds(db, traceIds, new Date())
}

/**
 * Purge content rows older than the workspace retention window. Returns the
 * number of rows whose content was nulled (generations + tool calls).
 */
export async function purgeOldTraceContentForWorkspace(
  db: Kysely<Database>,
  workspaceId: string,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = retentionCutoff(now, retentionDays)
  // Skip content belonging to in-flight (running) traces: pruning mid-flight
  // could race with generations/tool calls still being written.
  const [genResult, toolResult] = await Promise.all([
    db
      .updateTable('llm_generations')
      .set({ prompt: null, response: null, pruned_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('pruned_at', 'is', null)
      .where('created_at', '<', cutoff)
      .where((eb) => {
        return eb.not(eb.exists(
          eb.selectFrom('llm_traces as t')
            .select('t.id')
            .whereRef('t.id', '=', 'llm_generations.trace_id')
            .where('t.status', '=', 'running'),
        ))
      })
      .executeTakeFirstOrThrow(),
    db
      .updateTable('llm_tool_calls')
      .set({ output: null, pruned_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('pruned_at', 'is', null)
      .where('created_at', '<', cutoff)
      .where(eb =>
        eb.not(eb.exists(
          eb.selectFrom('llm_traces as t')
            .select('t.id')
            .whereRef('t.id', '=', 'llm_tool_calls.trace_id')
            .where('t.status', '=', 'running'),
        )),
      )
      .executeTakeFirstOrThrow(),
  ])

  return Number(genResult.numUpdatedRows ?? 0) + Number(toolResult.numUpdatedRows ?? 0)
}

/**
 * Purge content for traces whose owner no longer exists in notes,
 * conversations, or consolidation_runs. Catches deletions that bypass call
 * site helpers (e.g. synced-folder removal cascading to notes).
 */
export async function purgeOrphanTraceContent(
  db: Kysely<Database>,
  now: Date = new Date(),
): Promise<number> {
  const orphaned = await db
    .selectFrom('llm_traces as t')
    .select(['t.id', 't.workspace_id'])
    .where((eb) => {
      return eb.or([
        eb.and([
          eb('t.owner_type', '=', 'notes'),
          eb.not(
            eb.exists(
              eb.selectFrom('notes as n').select('n.id').whereRef('n.id', '=', 't.owner_id'),
            ),
          ),
        ]),
        eb.and([
          eb('t.owner_type', '=', 'conversations'),
          eb.not(
            eb.exists(
              eb.selectFrom('conversations as c').select('c.id').whereRef('c.id', '=', 't.owner_id'),
            ),
          ),
        ]),
        eb.and([
          eb('t.owner_type', '=', 'consolidation_runs'),
          eb.not(
            eb.exists(
              eb.selectFrom('consolidation_runs as r').select('r.id').whereRef('r.id', '=', 't.owner_id'),
            ),
          ),
        ]),
      ])
    })
    .execute()

  if (orphaned.length === 0)
    return 0

  return pruneContentForTraceIds(db, orphaned.map(t => t.id), now)
}

/**
 * Run the full daily observability retention sweep for all workspaces: prune
 * stale content per workspace setting, then purge orphaned traces. The job is
 * idempotent — a second run with the same `now` finds no unpruned rows to touch.
 */
export async function runObservabilityRetentionSweep(
  db: Kysely<Database>,
  now: Date = new Date(),
): Promise<{ prunedByAge: number, prunedOrphans: number }> {
  const workspaces = await db.selectFrom('workspaces').select('id').execute()
  let prunedByAge = 0
  for (const workspace of workspaces) {
    const retentionDays = await resolveContentRetentionDays(db, workspace.id)
    prunedByAge += await purgeOldTraceContentForWorkspace(db, workspace.id, retentionDays, now)
  }

  const prunedOrphans = await purgeOrphanTraceContent(db, now)
  return { prunedByAge, prunedOrphans }
}
