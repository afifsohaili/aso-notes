import type { RunPipelineOptions } from '../pipeline/run-pipeline'
import type { SyncDb } from './sweeper'
import { sql } from 'kysely'
import { RateLimitError } from '../ai/resilient-fetch'
import { createTrace, finishTrace, safeTraceWrite } from '../observability/trace-writer'
import { PipelineContext } from '../pipeline/context'
import { buildLastRun } from '../pipeline/last-run'
import { runPipeline } from '../pipeline/run-pipeline'

/**
 * Ingestion worker handler (plan-002-system §Sync service, slow path): load
 * the note row and run its pipeline. Atomic per note per content version —
 * the pipeline's final store-graph stage persists everything (including the
 * status='ingested'/ingested_hash flip) in one transaction, so a failure
 * only moves the row to 'failed' here and the BullMQ retry restarts from
 * the top.
 *
 * On every completed run (success or failure) we also write the latest
 * `last_run` jsonb record (plan-004). The success record is written after
 * runPipeline returns, outside the store-graph transaction, so a crash
 * between the status commit and the last_run update only loses the run
 * record, not the ingested state.
 *
 * Phase 3: each run also creates an `llm_traces` row (kind='ingestion',
 * owner_type='notes', owner_id=note.id). Extraction and embedding calls are
 * recorded as `llm_generations`. Trace writes are fire-and-forget so they
 * never break the pipeline.
 */
export async function ingestNote(args: {
  db: SyncDb
  noteId: string
  options?: RunPipelineOptions
  worker?: { attemptsMade?: number, jobId?: string | null }
}): Promise<void> {
  const { db, noteId, options, worker } = args

  const note = await db
    .selectFrom('notes')
    .select(['id', 'workspace_id', 'synced_folder_id', 'folder_id', 'path', 'title', 'content', 'content_hash', 'pipeline'])
    .where('id', '=', noteId)
    .executeTakeFirst()

  // Deleted between enqueue and run — nothing to do.
  if (!note)
    return

  // Flip the note into the active-processing state. We accept both 'queued'
  // (the normal BullMQ path) and 'pending' (inline/manual/test paths) so the
  // status model stays consistent regardless of how the run was started.
  // Guarded UPDATE prevents rolling an 'ingested' or 'failed' row backwards
  // if a stale job somehow runs after a retry/rebuild.
  await db
    .updateTable('notes')
    .set({ status: 'processing', updated_at: sql`now()` })
    .where('id', '=', note.id)
    .where('status', 'in', ['queued', 'pending'])
    .execute()

  const ctx = new PipelineContext({ note, workspaceId: note.workspace_id, db })

  // Create a trace for this ingestion run. If trace creation fails we still
  // run the pipeline, just without tracing.
  const traceId = await safeTraceWrite('createTrace', () => createTrace(db, {
    workspaceId: note.workspace_id,
    kind: 'ingestion',
    ownerType: 'notes',
    ownerId: note.id,
    status: 'running',
  }))

  if (traceId) {
    ctx.traceId = traceId
  }

  try {
    await runPipeline(note.pipeline, ctx, options)

    const lastRun = buildLastRun(ctx, { status: 'succeeded', worker })
    await db
      .updateTable('notes')
      .set({
        last_run: sql`${JSON.stringify(lastRun)}::jsonb`,
        updated_at: sql`now()`,
      })
      .where('id', '=', note.id)
      .execute()

    if (traceId) {
      await safeTraceWrite('finishTrace', () => finishTrace(db, { traceId, status: 'completed' }))
    }
  }
  catch (error) {
    const lastRun = buildLastRun(ctx, { status: 'failed', error, worker })

    // Rate limiting is a pause, not a failure: keep the note in processing so
    // BullMQ can resume it after the worker-level rate limit expires. All other
    // errors flip the note to failed so the normal BullMQ retry/backoff policy
    // (or the worker's UnrecoverableError mapping for fatal errors) applies.
    if (error instanceof RateLimitError) {
      await db
        .updateTable('notes')
        .set({
          last_run: sql`${JSON.stringify(lastRun)}::jsonb`,
          updated_at: sql`now()`,
        })
        .where('id', '=', note.id)
        .execute()
    }
    else {
      await db
        .updateTable('notes')
        .set({
          status: 'failed',
          last_run: sql`${JSON.stringify(lastRun)}::jsonb`,
          updated_at: sql`now()`,
        })
        .where('id', '=', note.id)
        .execute()
    }

    if (traceId) {
      await safeTraceWrite('finishTrace', () => finishTrace(db, {
        traceId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
    }

    // Rethrow so the worker processor can map resilient errors to BullMQ
    // control errors (RateLimitError / UnrecoverableError).
    throw error
  }
}
