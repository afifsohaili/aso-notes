import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Ticket 02 (plan-002 hybrid retrieval) — BM25 index over chunk text.
 *
 * Backs the lexical leg of hybrid search_notes. The index is Workspace-scoped
 * (workspace_id is the leading filter column) and covers the chunk text.
 * pg_search 0.25.x requires a `key_field` that is a column in the index; we use
 * the chunks primary key `id` as the leading column.
 *
 * Verified 0.25.x syntax (see ticket 01 notes and test/e2e/pg-search-extension.spec.ts):
 *   - index access method: `paradedb` (alias `bm25`), requires `key_field`
 *   - `key_field` must name a column present in the index column list
 *   - match operator: `|||` (match disjunction) / `&&&` (match conjunction)
 *   - scoring: `pdb.score(<key_field>)`
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX idx_chunks_bm25 ON chunks
    USING paradedb (id, workspace_id, text)
    WITH (key_field = 'id')
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_chunks_bm25`.execute(db)
}
