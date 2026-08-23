import type { AgentDb } from '../agent/types'
import { sql } from 'kysely'
import { halfvecLiteral } from '../agent/vector'
import { fuseRankedLists } from './fusion'

/** How many candidates each leg fetches before fusion. */
const BRANCH_LIMIT = 100

/** A fused chunk row with its note context and fused relevance score. */
export interface HybridChunkRow {
  id: string
  path: string
  title: string
  text: string
  seq: number
  score: number
}

interface DenseRow {
  id: string
  path: string
  title: string
  text: string
  seq: number
}

interface LexicalRow {
  id: string
  path: string
  title: string
  text: string
  seq: number
}

/**
 * Hybrid search over chunks: runs a dense (vector) leg and a lexical (BM25)
 * leg, both Workspace-scoped, and fuses the two ranked lists with RRF.
 * Returns fused rows ordered by descending fused score.
 */
export async function hybridSearchChunks(
  db: AgentDb,
  workspaceId: string,
  query: string,
  queryEmbedding: number[],
  limit: number,
): Promise<HybridChunkRow[]> {
  const [denseRows, lexicalRows] = await Promise.all([
    runDenseLeg(db, workspaceId, queryEmbedding),
    runLexicalLeg(db, workspaceId, query),
  ])

  const fused = fuseRankedLists([
    denseRows.map(r => ({ id: r.id })),
    lexicalRows.map(r => ({ id: r.id })),
  ])

  const byId = new Map<string, DenseRow>()
  for (const row of denseRows)
    byId.set(row.id, row)
  for (const row of lexicalRows) {
    if (!byId.has(row.id))
      byId.set(row.id, row)
  }

  return fused
    .slice(0, limit)
    .map(({ id, score }) => {
      const row = byId.get(id)!
      return { ...row, score }
    })
}

async function runDenseLeg(
  db: AgentDb,
  workspaceId: string,
  queryEmbedding: number[],
): Promise<DenseRow[]> {
  return db
    .selectFrom('chunks')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select([
      'chunks.id',
      'notes.path',
      'notes.title',
      'chunks.text',
      'chunks.seq',
      sql<number>`chunks.embedding <=> ${halfvecLiteral(queryEmbedding)}`.as('distance'),
    ])
    .where('chunks.workspace_id', '=', workspaceId)
    .where('notes.workspace_id', '=', workspaceId)
    .orderBy('distance', 'asc')
    .orderBy('chunks.id', 'asc')
    .limit(BRANCH_LIMIT)
    .execute()
}

async function runLexicalLeg(
  db: AgentDb,
  workspaceId: string,
  query: string,
): Promise<LexicalRow[]> {
  return db
    .selectFrom('chunks')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select([
      'chunks.id',
      'notes.path',
      'notes.title',
      'chunks.text',
      'chunks.seq',
      sql<number>`pdb.score(chunks.id)`.as('score'),
    ])
    .where('chunks.workspace_id', '=', workspaceId)
    .where('notes.workspace_id', '=', workspaceId)
    .where(sql<boolean>`chunks.text ||| ${query}`)
    .orderBy(sql`pdb.score(chunks.id)`, 'desc')
    .orderBy('chunks.id', 'asc')
    .limit(BRANCH_LIMIT)
    .execute()
}
