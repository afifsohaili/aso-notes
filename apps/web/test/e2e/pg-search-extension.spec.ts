import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'

/**
 * Ticket 01 — pg_search in the Postgres image.
 *
 * Proves the ParadeDB pg_search extension is present in the test database
 * (the template DB is provisioned from db/schema.sql, which is regenerated
 * from migrations) and that a BM25 index can be created and queried with
 * scoring. Pinned pg_search version: 0.25.3.
 *
 * Verified query syntax for 0.25.x (renamed from the 0.15–0.17 API):
 *   - index access method: `paradedb` (alias `bm25`), requires `key_field`
 *   - match operator: `|||` (match disjunction) / `&&&` (match conjunction)
 *   - scoring: `pdb.score(<key_field>)`
 */
describe('pg_search extension (BM25)', () => {
  test('pg_search extension exists in the test database', async ({ trx }) => {
    const { rows } = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_search'
    `.execute(trx)
    expect(rows).toHaveLength(1)
  })

  test('a BM25 index can be created and a match query with scoring round-trips', async ({ trx }) => {
    await sql`
      CREATE TABLE scratch_docs (
        id bigint PRIMARY KEY,
        body text NOT NULL
      )
    `.execute(trx)

    await sql`
      INSERT INTO scratch_docs (id, body) VALUES
        (1, 'the quick brown fox jumps over the lazy dog fox'),
        (2, 'a completely unrelated note about cooking pasta'),
        (3, 'another note about the fox and the dog')
    `.execute(trx)

    await sql`
      CREATE INDEX scratch_docs_idx ON scratch_docs
      USING paradedb (id, body)
      WITH (key_field = 'id')
    `.execute(trx)

    const { rows } = await sql<{ id: number, score: number }>`
      SELECT id::int AS id, pdb.score(id) AS score
      FROM scratch_docs
      WHERE body ||| 'fox'
      ORDER BY pdb.score(id) DESC, id ASC
    `.execute(trx)

    // Row 1 contains 'fox' twice, so it must rank first; row 2 has no match.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.id).toBe(1)
    expect(rows.map(r => r.id)).not.toContain(2)
  })
})
