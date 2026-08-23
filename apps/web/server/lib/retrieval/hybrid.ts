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

/** A fused concept row with its fused relevance score. */
export interface HybridConceptRow {
  id: string
  name: string
  description: string | null
  score: number
}

/** A candidate row from either leg, before fusion. */
interface CandidateRow {
  id: string
}

/** A chunk candidate row from either leg, before fusion. */
interface ChunkCandidateRow {
  id: string
  path: string
  title: string
  text: string
  seq: number
}

/** A concept candidate row from either leg, before fusion. */
interface ConceptCandidateRow {
  id: string
  name: string
  description: string | null
}

/**
 * Generic hybrid search: runs a dense (vector) leg and a lexical (BM25) leg,
 * both Workspace-scoped, and fuses the two ranked lists with RRF. Returns
 * fused rows ordered by descending fused score.
 */
async function hybridSearch<T extends CandidateRow>(
  db: AgentDb,
  workspaceId: string,
  query: string,
  queryEmbedding: number[],
  limit: number,
  legs: {
    dense: () => Promise<T[]>
    lexical: () => Promise<T[]>
  },
): Promise<(T & { score: number })[]> {
  const [denseRows, lexicalRows] = await Promise.all([
    legs.dense(),
    legs.lexical(),
  ])

  const fused = fuseRankedLists([
    denseRows.map(r => ({ id: r.id })),
    lexicalRows.map(r => ({ id: r.id })),
  ])

  const byId = new Map<string, T>()
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
  return hybridSearch(db, workspaceId, query, queryEmbedding, limit, {
    dense: () => runDenseLeg(db, workspaceId, queryEmbedding),
    lexical: () => runLexicalLeg(db, workspaceId, query),
  })
}

/**
 * Hybrid search over concepts: runs a dense (vector) leg and a lexical (BM25)
 * leg, both Workspace-scoped, and fuses the two ranked lists with RRF.
 * Returns fused rows ordered by descending fused score.
 */
export async function hybridSearchConcepts(
  db: AgentDb,
  workspaceId: string,
  query: string,
  queryEmbedding: number[],
  limit: number,
): Promise<HybridConceptRow[]> {
  return hybridSearch(db, workspaceId, query, queryEmbedding, limit, {
    dense: () => runConceptDenseLeg(db, workspaceId, queryEmbedding),
    lexical: () => runConceptLexicalLeg(db, workspaceId, query),
  })
}

async function runConceptDenseLeg(
  db: AgentDb,
  workspaceId: string,
  queryEmbedding: number[],
): Promise<ConceptCandidateRow[]> {
  return db
    .selectFrom('concepts')
    .select([
      'id',
      'name',
      'description',
      sql<number>`embedding <=> ${halfvecLiteral(queryEmbedding)}`.as('distance'),
    ])
    .where('workspace_id', '=', workspaceId)
    .orderBy('distance', 'asc')
    .orderBy('id', 'asc')
    .limit(BRANCH_LIMIT)
    .execute()
}

async function runConceptLexicalLeg(
  db: AgentDb,
  workspaceId: string,
  query: string,
): Promise<ConceptCandidateRow[]> {
  return db
    .selectFrom('concepts')
    .select([
      'id',
      'name',
      'description',
      sql<number>`pdb.score(concepts.id)`.as('score'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where(sql<boolean>`(concepts.name ||| ${query} OR concepts.description ||| ${query})`)
    .orderBy(sql`pdb.score(concepts.id)`, 'desc')
    .orderBy('id', 'asc')
    .limit(BRANCH_LIMIT)
    .execute()
}

async function runDenseLeg(
  db: AgentDb,
  workspaceId: string,
  queryEmbedding: number[],
): Promise<ChunkCandidateRow[]> {
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
): Promise<ChunkCandidateRow[]> {
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
