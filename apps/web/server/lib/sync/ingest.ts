import type { RunPipelineOptions } from '../pipeline/run-pipeline'
import type { SyncDb } from './sweeper'
import { sql } from 'kysely'
import { PipelineContext } from '../pipeline/context'
import { runPipeline } from '../pipeline/run-pipeline'

/**
 * Ingestion worker handler (plan-002-system §Sync service, slow path): load
 * the note row, run its pipeline, then flip status. Atomic per note per
 * content version — nothing persists before the pipeline's final store stage,
 * so a failure only moves the row to 'failed' and the BullMQ retry restarts
 * from the top.
 *
 * M4 note: the store-graph stage will own the ingested_hash/status write
 * inside its final transaction; the update here is idempotent with that.
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
    await db
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: note.content_hash, updated_at: sql`now()` })
      .where('id', '=', note.id)
      .execute()
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
