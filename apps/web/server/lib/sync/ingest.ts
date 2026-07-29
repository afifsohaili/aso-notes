import type { RunPipelineOptions } from '../pipeline/run-pipeline'
import type { SyncDb } from './sweeper'
import { sql } from 'kysely'
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
    .select(['id', 'workspace_id', 'folder_id', 'path', 'title', 'content', 'content_hash', 'pipeline'])
    .where('id', '=', noteId)
    .executeTakeFirst()

  // Deleted between enqueue and run — nothing to do.
  if (!note)
    return

  const ctx = new PipelineContext({ note, workspaceId: note.workspace_id, db })

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
  }
  catch (error) {
    const lastRun = buildLastRun(ctx, { status: 'failed', error, worker })
    await db
      .updateTable('notes')
      .set({
        status: 'failed',
        last_run: sql`${JSON.stringify(lastRun)}::jsonb`,
        updated_at: sql`now()`,
      })
      .where('id', '=', note.id)
      .execute()
    // Rethrow so BullMQ applies its retry/backoff policy.
    throw error
  }
}
