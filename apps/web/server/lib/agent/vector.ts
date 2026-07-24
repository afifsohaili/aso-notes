import { sql } from 'kysely'

/** Render a 2048-dim float array as a `halfvec` SQL literal for pgvector. */
export function halfvecLiteral(embedding: number[]) {
  return sql`CAST(${`[${embedding.join(',')}]`} AS halfvec)`
}
