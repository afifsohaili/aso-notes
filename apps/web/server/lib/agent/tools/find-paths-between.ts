import type { AgentTool, AgentToolResult } from '../types'
import { agLiteral, parseAgtype, queryCypher } from '../../graph/age'

export const FIND_PATHS_BETWEEN_TOOL_NAME = 'find_paths_between'

interface PathRow {
  node_list: unknown
  edge_list: unknown
  length: unknown
}

function parseAgtypeList(value: unknown): any[] {
  const text = parseAgtype(value)
  if (typeof text !== 'string')
    return []
  const cleaned = text.replace(/::\w+/g, '')
  try {
    return JSON.parse(cleaned) as any[]
  }
  catch {
    return []
  }
}

export const findPathsBetweenTool: AgentTool = {
  name: FIND_PATHS_BETWEEN_TOOL_NAME,
  description: 'Find graph paths between two concepts through related-concept edges.',
  parameters: {
    type: 'object',
    properties: {
      start_concept_id: {
        type: 'string',
        description: 'UUID of the starting concept.',
      },
      end_concept_id: {
        type: 'string',
        description: 'UUID of the ending concept.',
      },
      max_depth: {
        type: 'integer',
        description: 'Maximum path length in hops (default 4, max 6).',
        minimum: 1,
        maximum: 6,
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of paths to return (default 5).',
        minimum: 1,
        maximum: 20,
      },
    },
    required: ['start_concept_id', 'end_concept_id'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const startId = String(args.start_concept_id ?? '').trim()
    const endId = String(args.end_concept_id ?? '').trim()
    if (!startId || !endId)
      return { result: { error: 'start_concept_id and end_concept_id are required' }, notes: [] }

    const maxDepth = Math.max(1, Math.min(6, Math.floor(Number(args.max_depth) || 4)))
    const limit = Math.max(1, Math.min(20, Math.floor(Number(args.limit) || 5)))

    const rows = await queryCypher<PathRow>(
      ctx.db,
      [
        `MATCH p=(a:Concept {id: ${agLiteral(startId)}})-[:RELATES_TO*1..${maxDepth}]-(b:Concept {id: ${agLiteral(endId)}})`,
        `WHERE a.workspace_id = ${agLiteral(ctx.workspaceId)} AND b.workspace_id = ${agLiteral(ctx.workspaceId)}`,
        'RETURN nodes(p) AS node_list, relationships(p) AS edge_list, length(p) AS length',
        'ORDER BY length(p)',
        `LIMIT ${limit}`,
      ].join(' '),
      'node_list ag_catalog.agtype, edge_list ag_catalog.agtype, length ag_catalog.agtype',
    )

    const paths = rows.map((row) => {
      const nodes = parseAgtypeList(row.node_list) as Array<{ id: number, label: string, properties: { id: string, name: string } }>
      const edges = parseAgtypeList(row.edge_list) as Array<{ label: string, properties: { type: string } }>
      return {
        nodes: nodes.map(n => ({ id: n.properties.id, name: n.properties.name })),
        edges: edges.map(e => ({ type: e.properties.type })),
        length: Number(parseAgtype(row.length)),
      }
    })

    return {
      result: { paths, count: paths.length },
      notes: [],
    }
  },
}
