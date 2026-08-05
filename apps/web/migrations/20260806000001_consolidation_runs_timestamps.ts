import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * M — add missing audit timestamps to consolidation_runs.
 *
 * The base consolidation migration was edited after first application, leaving
 * existing applied schemas without created_at/updated_at. This follow-up adds
 * them with the same defaults so the table matches the canonical schema.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table consolidation_runs
      add column if not exists created_at timestamp not null default now(),
      add column if not exists updated_at timestamp not null default now()
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table consolidation_runs
      drop column if exists created_at,
      drop column if exists updated_at
  `.execute(db)
}
