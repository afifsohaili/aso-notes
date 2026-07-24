import type { AgentTool, AgentToolResult } from '../types'
import { conceptNeighbors } from '../../graph'

export const GET_CONCEPT_NEIGHBORS_TOOL_NAME = 'get_concept_neighbors'

export const getConceptNeighborsTool: AgentTool = {
  name: GET_CONCEPT_NEIGHBORS_TOOL_NAME,
  description: 'Find concepts directly or indirectly related to a given concept in the knowledge graph.',
  parameters: {
    type: 'object',
    properties: {
      concept_id: {
        type: 'string',
        description: 'UUID of the concept to expand from.',
      },
      depth: {
        type: 'integer',
        description: 'Graph-hop depth (default 2, max 4).',
        minimum: 1,
        maximum: 4,
      },
    },
    required: ['concept_id'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const conceptId = String(args.concept_id ?? '').trim()
    if (!conceptId)
      return { result: { error: 'concept_id is required' }, notes: [] }

    const depth = Math.max(1, Math.min(4, Math.floor(Number(args.depth) || 2)))
    const neighbors = await conceptNeighbors(ctx.db, { conceptId, workspaceId: ctx.workspaceId, depth })

    return {
      result: { neighbors, count: neighbors.length },
      notes: [],
    }
  },
}
