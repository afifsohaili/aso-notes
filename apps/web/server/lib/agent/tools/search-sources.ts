import type { AgentTool, AgentToolResult } from '../types'

export const SEARCH_SOURCES_TOOL_NAME = 'search_sources'

export const searchSourcesTool: AgentTool = {
  name: SEARCH_SOURCES_TOOL_NAME,
  description: 'Search external sources (URLs) attached to notes by URL or title substring.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Substring to match against the source URL or title.',
      },
      type: {
        type: 'string',
        description: 'Optional source type filter: youtube, tiktok, or web.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum results (default 10).',
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query)
      return { result: { error: 'query is required' }, notes: [] }

    const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)))
    const typeFilter = args.type ? String(args.type).trim().toLowerCase() : undefined

    let q = ctx.db
      .selectFrom('sources')
      .innerJoin('notes', 'notes.id', 'sources.note_id')
      .select([
        'sources.url',
        'sources.title',
        'sources.type',
        'notes.path',
        'notes.title as note_title',
      ])
      .where('sources.workspace_id', '=', ctx.workspaceId)
      .where(eb => eb.or([
        eb('sources.url', 'ilike', `%${query}%`),
        eb('sources.title', 'ilike', `%${query}%`),
      ]))

    if (typeFilter)
      q = q.where('sources.type', '=', typeFilter)

    const rows = await q.orderBy('sources.created_at', 'desc').limit(limit).execute()

    const sources = rows.map(row => ({
      url: row.url,
      title: row.title,
      type: row.type,
      note_path: row.path,
      note_title: row.note_title,
    }))

    return {
      result: { sources, count: sources.length },
      notes: [...new Set(rows.map(row => row.path))],
    }
  },
}
