import type { GraphDb } from './graph/age'
import { sql } from 'kysely'
import { NOTES_GRAPH } from './graph/age'

export interface RebuildCounts {
  mentions: number
  relations: number
  conceptTopics: number
  concepts: number
  topics: number
  chunks: number
  links: number
  sources: number
  aiNoteTags: number
}

export interface RebuildResult {
  wiped: RebuildCounts
  notesReset: number
}

/**
 * Fully rebuild the graph-derived data for a workspace:
 * - Truncate graph-derived relational tables for this workspace.
 * - Delete only AI-origin note_tags; preserve user tags and all dismissals.
 * - Drop + recreate the shared Apache AGE graph (single graph for the MVP).
 * - Set every note in the workspace back to status='pending' for re-ingestion.
 *
 * The caller is responsible for wrapping this in a transaction if atomicity is
 * required; the function performs the operations on the supplied db handle.
 */
export async function rebuildWorkspaceGraph(db: GraphDb, workspaceId: string): Promise<RebuildResult> {
  const [
    mentions,
    relations,
    conceptTopics,
    concepts,
    topics,
    chunks,
    links,
    sources,
    aiNoteTags,
  ] = await Promise.all([
    countWorkspaceRows(db, 'mentions', workspaceId),
    countWorkspaceRows(db, 'relations', workspaceId),
    countWorkspaceRows(db, 'concept_topics', workspaceId),
    countWorkspaceRows(db, 'concepts', workspaceId),
    countWorkspaceRows(db, 'topics', workspaceId),
    countWorkspaceRows(db, 'chunks', workspaceId),
    countWorkspaceRows(db, 'links', workspaceId),
    countWorkspaceRows(db, 'sources', workspaceId),
    countAiNoteTags(db, workspaceId),
  ])

  await deleteWorkspaceRows(db, 'mentions', workspaceId)
  await deleteWorkspaceRows(db, 'relations', workspaceId)
  await deleteWorkspaceRows(db, 'concept_topics', workspaceId)
  await deleteWorkspaceRows(db, 'concepts', workspaceId)
  await deleteWorkspaceRows(db, 'topics', workspaceId)
  await deleteWorkspaceRows(db, 'chunks', workspaceId)
  await deleteWorkspaceRows(db, 'links', workspaceId)
  await deleteWorkspaceRows(db, 'sources', workspaceId)

  await db
    .deleteFrom('note_tags')
    .where('workspace_id', '=', workspaceId)
    .where('origin', '=', 'ai')
    .execute()

  await sql`SELECT ag_catalog.drop_graph(${NOTES_GRAPH}, true)`.execute(db)
  await sql`SELECT ag_catalog.create_graph(${NOTES_GRAPH})`.execute(db)

  const notesResetResult = await db
    .updateTable('notes')
    .set({ status: 'pending' })
    .where('workspace_id', '=', workspaceId)
    .where('status', '<>', 'pending')
    .executeTakeFirstOrThrow()

  return {
    wiped: {
      mentions,
      relations,
      conceptTopics,
      concepts,
      topics,
      chunks,
      links,
      sources,
      aiNoteTags,
    },
    notesReset: Number(notesResetResult.numUpdatedRows ?? 0),
  }
}

async function countWorkspaceRows(db: GraphDb, table: string, workspaceId: string): Promise<number> {
  const result = await sql<{ c: number }>`SELECT count(*)::int AS c FROM ${sql.table(table)} WHERE workspace_id = ${workspaceId}`.execute(db)
  return Number(result.rows[0]?.c ?? 0)
}

async function countAiNoteTags(db: GraphDb, workspaceId: string): Promise<number> {
  const result = await sql<{ c: number }>`
    SELECT count(*)::int AS c FROM note_tags
    WHERE workspace_id = ${workspaceId} AND origin = 'ai'
  `.execute(db)
  return Number(result.rows[0]?.c ?? 0)
}

async function deleteWorkspaceRows(db: GraphDb, table: string, workspaceId: string): Promise<void> {
  await sql`DELETE FROM ${sql.table(table)} WHERE workspace_id = ${workspaceId}`.execute(db)
}
