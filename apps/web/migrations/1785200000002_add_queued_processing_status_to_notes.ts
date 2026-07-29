import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * O5 — extends notes.status to include the queue lifecycle states
 * 'queued' and 'processing' (plan-004 Phase 2).
 *
 * Pending notes are settling files. The dispatcher flips them to 'queued'
 * after a successful BullMQ enqueue. The worker flips 'queued' (or inline
 * 'pending') to 'processing' when ingestion starts. Terminal states remain
 * 'ingested' and 'failed'.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE notes DROP CONSTRAINT notes_status_check`.execute(db)
  await sql`ALTER TABLE notes ADD CONSTRAINT notes_status_check CHECK (status IN ('pending', 'queued', 'processing', 'ingested', 'failed'))`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE notes DROP CONSTRAINT notes_status_check`.execute(db)
  await sql`ALTER TABLE notes ADD CONSTRAINT notes_status_check CHECK (status IN ('pending', 'ingested', 'failed'))`.execute(db)
}
