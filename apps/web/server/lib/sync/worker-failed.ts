import type { SyncDb } from './sweeper'
import { sql } from 'kysely'

/**
 * Flip a note to failed when BullMQ declares the job failed (after retries).
 * Guarded so it only touches rows that are still queued/processing, avoiding
 * a race where a successful retry finished just as the failure event fired.
 */
export async function handleFailedIngestionJob(db: SyncDb, noteId: string | undefined): Promise<void> {
  if (!noteId)
    return

  await db
    .updateTable('notes')
    .set({ status: 'failed', updated_at: sql`now()` })
    .where('id', '=', noteId)
    .where('status', 'in', ['queued', 'processing'])
    .execute()
}
