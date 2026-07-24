import type { AgentTool, AgentToolResult } from '../types'

export const GET_MENTIONS_TOOL_NAME = 'get_mentions'

export const getMentionsTool: AgentTool = {
  name: GET_MENTIONS_TOOL_NAME,
  description: 'Find all note chunks that mention a specific concept, grouped by note.',
  parameters: {
    type: 'object',
    properties: {
      concept_id: {
        type: 'string',
        description: 'UUID of the concept.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of chunks to return (default 10).',
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['concept_id'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const conceptId = String(args.concept_id ?? '').trim()
    if (!conceptId)
      return { result: { error: 'concept_id is required' }, notes: [] }

    const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)))

    const rows = await ctx.db
      .selectFrom('mentions')
      .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
      .innerJoin('notes', 'notes.id', 'chunks.note_id')
      .select([
        'notes.path',
        'notes.title',
        'chunks.text',
        'chunks.seq',
      ])
      .where('mentions.workspace_id', '=', ctx.workspaceId)
      .where('mentions.concept_id', '=', conceptId)
      .orderBy(['notes.path', 'chunks.seq'])
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
