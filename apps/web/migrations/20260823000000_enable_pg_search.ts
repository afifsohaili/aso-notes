import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Ticket 01 (plan-002 hybrid retrieval) — enable ParadeDB pg_search.
 *
 * The extension ships in the project's Postgres image (docker/postgres/Dockerfile),
 * pinned to pg_search 0.25.3. This migration makes it available in the database
 * so BM25 indexes can be created.
 *
 * Verified BM25 query syntax for 0.25.x (renamed from the 0.15-0.17 API):
 *   - index access method: `paradedb` (alias `bm25`), requires `key_field`
 *   - match operator: `|||` (match disjunction) / `&&&` (match conjunction)
 *   - scoring: `pdb.score(<key_field>)`
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_search`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP EXTENSION IF EXISTS pg_search`.execute(db)
}
