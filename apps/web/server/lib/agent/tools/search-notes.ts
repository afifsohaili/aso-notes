import type { AgentTool, AgentToolResult } from '../types'
import { sql } from 'kysely'
import { halfvecLiteral } from '../vector'

export const SEARCH_NOTES_TOOL_NAME = 'search_notes'

export const searchNotesTool: AgentTool = {
  name: SEARCH_NOTES_TOOL_NAME,
  description: 'Semantic search over note chunks. Returns the most relevant note passages for a query.',
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
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query)
      return { result: { error: 'query is required' }, notes: [] }

    const limit = Math.max(1, Math.min(20, Math.floor(Number(args.limit) || 5)))
    const [queryEmbedding] = await ctx.embedding.embed([query])

    const rows = await ctx.db
      .selectFrom('chunks')
      .innerJoin('notes', 'notes.id', 'chunks.note_id')
      .select([
        'notes.path',
        'notes.title',
        'chunks.text',
        'chunks.seq',
        sql<number>`chunks.embedding <=> ${halfvecLiteral(queryEmbedding!)}`.as('distance'),
      ])
      .where('chunks.workspace_id', '=', ctx.workspaceId)
      .where('notes.workspace_id', '=', ctx.workspaceId)
      .orderBy('distance', 'asc')
      .limit(limit)
      .execute()

    const byNote = new Map<string, { path: string, title: string, chunks: { text: string, seq: number }[] }>()
    for (const row of rows) {
      const existing = byNote.get(row.path)
      if (existing) {
        existing.chunks.push({ text: row.text, seq: row.seq })
      }
      else {
        byNote.set(row.path, { path: row.path, title: row.title, chunks: [{ text: row.text, seq: row.seq }] })
      }
    }

    const notes = [...byNote.values()]
    return {
      result: { notes, count: notes.length },
      notes: notes.map(n => n.path),
    }
  },
}
