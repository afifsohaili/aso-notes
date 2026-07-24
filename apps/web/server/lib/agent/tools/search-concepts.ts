import type { AgentTool, AgentToolResult } from '../types'
import { sql } from 'kysely'
import { halfvecLiteral } from '../vector'

export const SEARCH_CONCEPTS_TOOL_NAME = 'search_concepts'

export const searchConceptsTool: AgentTool = {
  name: SEARCH_CONCEPTS_TOOL_NAME,
  description: 'Semantic search over extracted concepts by their embeddings.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language concept query.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of concepts to return (default 5).',
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
      .selectFrom('concepts')
      .select([
        'id',
        'name',
        'description',
        sql<number>`embedding <=> ${halfvecLiteral(queryEmbedding!)}`.as('distance'),
      ])
      .where('workspace_id', '=', ctx.workspaceId)
      .orderBy('distance', 'asc')
      .limit(limit)
      .execute()

    const concepts = rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      distance: row.distance,
    }))

    return {
      result: { concepts, count: concepts.length },
      notes: [],
    }
  },
}
