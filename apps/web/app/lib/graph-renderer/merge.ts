import type { GraphEdge, GraphNode } from './types'

/**
 * Page-level graph merges (Phase 4 drill-down): the ego-graph neighborhood
 * payload is appended to the current overview. `setGraph` on the renderer is
 * a full replacement, so the page must dedupe before handing data over.
 */

export function mergeGraphNodes(current: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const byId = new Map<string, GraphNode>()
  for (const node of current)
    byId.set(node.id, node)
  for (const node of incoming) {
    if (!byId.has(node.id))
      byId.set(node.id, node)
  }
  return [...byId.values()]
}

/** Edges are directed; the key is source|target|edge type (+ relation type). */
function edgeKey(edge: GraphEdge): string {
  return `${edge.source}|${edge.target}|${edge.type}|${edge.edgeType ?? ''}`
}

export function mergeGraphEdges(current: GraphEdge[], incoming: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>()
  const merged: GraphEdge[] = []
  for (const edge of [...current, ...incoming]) {
    const key = edgeKey(edge)
    if (seen.has(key))
      continue
    seen.add(key)
    merged.push(edge)
  }
  return merged
}
