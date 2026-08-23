import type { AgentDb, AgentTool, AgentToolResult } from '../types'
import { expandRelatedChunks, hybridSearchChunks } from '../../retrieval'

export const SEARCH_NOTES_TOOL_NAME = 'search_notes'

export const searchNotesTool: AgentTool = {
  name: SEARCH_NOTES_TOOL_NAME,
  description: 'Hybrid semantic + lexical search over note chunks. Returns the most relevant note passages for a query, plus graph-related passages surfaced by traversing one hop of Relations from the matched Concepts. Each related passage carries its provenance chain (matched Concept → Relation → neighbor Concept) so you can cite why it was included.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language search query.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of note chunks to return (default 5).',
        minimum: 1,
        maximum: 20,
      },
      relatedLimit: {
        type: 'integer',
        description: 'Maximum number of graph-expanded related chunks to return alongside the direct hits (default 3, min 1, max 10). Related chunks are grouped per-note.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query)
      return { result: { error: 'query is required' }, notes: [] }

    const limit = Math.max(1, Math.min(20, Math.floor(Number(args.limit) || 5)))
    // Default 3; clamped to the 1–10 range like `limit`.
    const relatedLimit = args.relatedLimit === undefined
      ? 3
      : Math.max(1, Math.min(10, Math.floor(Number(args.relatedLimit) || 3)))
    const [queryEmbedding] = await ctx.embedding.embed([query])

    const rows = await hybridSearchChunks(ctx.db, ctx.workspaceId, query, queryEmbedding!, limit)

    const byNote = new Map<string, { path: string, title: string, chunks: { text: string, seq: number, score: number }[] }>()
    const directChunkIds: string[] = []
    for (const row of rows) {
      directChunkIds.push(row.id)
      const existing = byNote.get(row.path)
      if (existing) {
        existing.chunks.push({ text: row.text, seq: row.seq, score: row.score })
      }
      else {
        byNote.set(row.path, { path: row.path, title: row.title, chunks: [{ text: row.text, seq: row.seq, score: row.score }] })
      }
    }

    const notes = [...byNote.values()]
    const result: Record<string, unknown> = { notes, count: notes.length }

    if (notes.length > 0) {
      // Exclude the Notes already in the direct result from expansion so a
      // neighbor can never re-surface a direct hit's Note.
      const excludedIds = await excludedNoteIds(ctx.db, ctx.workspaceId, [...byNote.keys()])
      const related = await expandRelatedChunks(ctx.db, ctx.workspaceId, {
        resultChunkIds: directChunkIds,
        excludedNoteIds: excludedIds,
        relatedLimit,
      })
      result.related = related
    }

    const relatedPaths = Array.isArray(result.related)
      ? (result.related as { path: string }[]).map(r => r.path)
      : []
    return {
      result,
      notes: [...notes.map(n => n.path), ...relatedPaths],
    }
  },
}

/** Note ids for the paths that appear in the direct result, for expansion exclusion. */
async function excludedNoteIds(
  db: AgentDb,
  workspaceId: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0)
    return []
  const rows = await db
    .selectFrom('notes')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('path', 'in', paths)
    .execute()
  return rows.map(r => r.id)
}
