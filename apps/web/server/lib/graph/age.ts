import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'

/**
 * Low-level Apache AGE access (plan-002-system §AGE graph). Every graph read
 * or write goes through these helpers — no scattered cypher strings.
 *
 * AGE specifics handled here:
 * - cypher() needs `LOAD 'age'` once per session (idempotent; run per call).
 * - AGE rewrites cypher() calls at parse-analysis time, so the query string
 *   must be a SQL literal — values are interpolated as escaped cypher
 *   literals (agLiteral), never as bound parameters.
 * - The graph is single-tenant for the MVP (`notes_graph`); every helper
 *   takes an optional graph name so per-workspace graphs can come later.
 */

export const NOTES_GRAPH = 'notes_graph'

export type GraphDb = Kysely<DB> | Transaction<DB>

/** Dollar-quote delimiter for the cypher query literal. */
const CYPHER_DELIMITER = '$age$'

/** Escape a JS string as a cypher string literal (backslash escapes). */
export function agLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')
  return `'${escaped}'`
}

export type AgPropertyValue = string | number | boolean | null

/** Render a single cypher value literal. */
export function agValue(value: AgPropertyValue): string {
  return typeof value === 'string' ? agLiteral(value) : String(value)
}

/** Render a cypher map literal: {k: 'v', n: 1, b: true}. Null values are omitted. */
export function agProperties(props: Record<string, AgPropertyValue | undefined>): string {
  const entries = Object.entries(props)
    .filter((entry): entry is [string, AgPropertyValue] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => `${key}: ${agValue(value)}`)
  return `{${entries.join(', ')}}`
}

/** Parse an agtype result value: strings arrive JSON-encoded, scalars raw. */
export function parseAgtype(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}

function cypherStatement(graph: string, query: string, columns: string): string {
  if (query.includes(CYPHER_DELIMITER))
    throw new Error('cypher query contains the dollar-quote delimiter')
  const graphLiteral = `'${graph.replace(/'/g, '\'\'')}'`
  return `SELECT * FROM ag_catalog.cypher(${graphLiteral}, ${CYPHER_DELIMITER}${query}${CYPHER_DELIMITER}) AS (${columns})`
}

/**
 * AGE session preamble: LOAD the library (parse hook) and put ag_catalog on
 * the search path (agtype operators like @> resolve via search_path).
 * SET LOCAL scopes the search_path change to the surrounding transaction —
 * every graph access in this codebase runs inside one (store-graph's final
 * transaction, or the e2e harness's).
 */
async function agePreamble(db: GraphDb): Promise<void> {
  await sql`LOAD 'age'`.execute(db)
  await sql`SET LOCAL search_path = ag_catalog, "$user", public`.execute(db)
}

/** Run a write cypher query (no RETURN) against the graph. */
export async function executeCypher(db: GraphDb, query: string, graph: string = NOTES_GRAPH): Promise<void> {
  await agePreamble(db)
  await sql.raw(cypherStatement(graph, query, 'ignored ag_catalog.agtype')).execute(db)
}

/**
 * Run a read cypher query. `columns` is the column-definition list, e.g.
 * `'name ag_catalog.agtype, distance ag_catalog.agtype'`; every selected
 * value arrives as agtype text (see parseAgtype).
 */
export async function queryCypher<T extends Record<string, unknown>>(
  db: GraphDb,
  query: string,
  columns: string,
  graph: string = NOTES_GRAPH,
): Promise<T[]> {
  await agePreamble(db)
  const { rows } = await sql.raw<T>(cypherStatement(graph, query, columns)).execute(db)
  return rows
}
