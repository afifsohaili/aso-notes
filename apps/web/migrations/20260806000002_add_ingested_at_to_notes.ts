import type { Kysely } from 'kysely'

/**
 * Phase 8 hardening (plan-010): track when a Note actually finished
 * Ingestion. Restore-after-snapshot resets Notes ingested after the snapshot
 * so they re-extract against the restored vocabulary; `created_at` could not
 * express "created before the snapshot but ingested after it".
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('notes')
    .addColumn('ingested_at', 'timestamp')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('notes')
    .dropColumn('ingested_at')
    .execute()
}
