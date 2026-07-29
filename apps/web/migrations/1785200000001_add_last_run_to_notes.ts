import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * O1 — adds `notes.last_run` jsonb column (plan-004).
 *
 * Stores the latest ingestion run payload (success or failure). Nullable:
 * `NULL` until the first ingestion attempt completes.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('notes')
    .addColumn('last_run', 'jsonb', col => col.defaultTo(sql`NULL`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('notes')
    .dropColumn('last_run')
    .execute()
}
