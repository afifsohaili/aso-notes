import type { Kysely } from 'kysely'

/**
 * Phase 1 (synced-folder disambiguation) — user-facing alias for a Synced Folder.
 *
 * The sidebar root label becomes `alias ?? basename(path)`. Alias is nullable
 * and wins over the basename-collision prefix logic.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('synced_folders')
    .addColumn('alias', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('synced_folders')
    .dropColumn('alias')
    .execute()
}
