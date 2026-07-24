import type { RunPipelineOptions } from '../pipeline/run-pipeline'
import type { SyncDb } from './sweeper'
import { sql } from 'kysely'
import { PipelineContext } from '../pipeline/context'
import { runPipeline } from '../pipeline/run-pipeline'

/**
 * Ingestion worker handler (plan-002-system §Sync service, slow path): load
 * the note row and run its pipeline. Atomic per note per content version —
 * the pipeline's final store-graph stage persists everything (including the
 * status='ingested'/ingested_hash flip) in one transaction, so a failure
 * only moves the row to 'failed' here and the BullMQ retry restarts from
 * the top.
 *
 * The M1 schema has no error column: failures are logged and visible via
 * BullMQ failed-job retention.
 */
export async function ingestNote(args: {
  db: SyncDb
  noteId: string
  options?: RunPipelineOptions
}): Promise<void> {
  const { db, noteId, options } = args

  const note = await db
    .selectFrom('notes')
    .select(['id', 'workspace_id', 'folder_id', 'path', 'title', 'content', 'content_hash', 'pipeline'])
    .where('id', '=', noteId)
    .executeTakeFirst()

  // Deleted between enqueue and run — nothing to do.
  if (!note)
    return

  try {
    await runPipeline(
      note.pipeline,
      new PipelineContext({ note, workspaceId: note.workspace_id, db }),
      options,
    )
  }
  catch (error) {
    await db
      .updateTable('notes')
      .set({ status: 'failed', updated_at: sql`now()` })
      .where('id', '=', note.id)
      .execute()
    // Rethrow so BullMQ applies its retry/backoff policy.
    throw error
  }
}
