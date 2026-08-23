import type { AgentTool, AgentToolResult } from '../types'
import { hybridSearchChunks } from '../../retrieval'

export const SEARCH_NOTES_TOOL_NAME = 'search_notes'

export const searchNotesTool: AgentTool = {
  name: SEARCH_NOTES_TOOL_NAME,
  description: 'Hybrid semantic + lexical search over note chunks. Returns the most relevant note passages for a query.',
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

    const rows = await hybridSearchChunks(ctx.db, ctx.workspaceId, query, queryEmbedding!, limit)

    const byNote = new Map<string, { path: string, title: string, chunks: { text: string, seq: number, score: number }[] }>()
    for (const row of rows) {
      const existing = byNote.get(row.path)
      if (existing) {
        existing.chunks.push({ text: row.text, seq: row.seq, score: row.score })
      }
      else {
        byNote.set(row.path, { path: row.path, title: row.title, chunks: [{ text: row.text, seq: row.seq, score: row.score }] })
      }
    }

    const notes = [...byNote.values()]
    return {
      result: { notes, count: notes.length },
      notes: notes.map(n => n.path),
    }
  },
}
