import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('conversations')
    .addColumn('archived_at', 'timestamp')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('conversations')
    .dropColumn('archived_at')
    .execute()
}
