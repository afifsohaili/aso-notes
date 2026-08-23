import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Ticket 03 (plan-002 hybrid retrieval) — BM25 index over concept name + description.
 *
 * Backs the lexical leg of hybrid search_concepts. The index is Workspace-scoped
 * (workspace_id is the leading filter column) and covers the concept name and
 * description. pg_search 0.25.x requires a `key_field` that is a column in the
 * index; we use the concepts primary key `id` as the leading column (same shape
 * as the chunks BM25 index from ticket 02).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX idx_concepts_bm25 ON concepts
    USING paradedb (id, workspace_id, name, description)
    WITH (key_field = 'id')
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_concepts_bm25`.execute(db)
}
