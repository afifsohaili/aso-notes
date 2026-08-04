import type Graph from 'graphology'
import type { GraphEdge, GraphNode } from './types'
import { EDGE_COLOR, NODE_COLORS } from './constants'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function edgeKey(source: string, target: string): string {
  return source < target ? `${source}|${target}` : `${target}|${source}`
}

/**
 * Pure computation of effective node/edge colors for a given highlight state.
 *
 * - No highlight (or unknown id): every node and edge keeps its base color.
 * - Highlighted node + its 1-hop neighbors keep full opacity; all other nodes
 *   and edges are dimmed to 0.2 alpha.
 *
 * Edge colors are keyed by the sorted undirected pair. Duplicate undirected
 * edges (which the graph store drops) are ignored here; the first edge in
 * array order wins.
 */
export function computeHighlightColors(
  nodes: GraphNode[],
  edges: GraphEdge[],
  highlightedId: string | null,
): { nodeColors: Map<string, string>, edgeColors: Map<string, string> } {
  const nodeColors = new Map<string, string>()
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    nodeColors.set(node.id, NODE_COLORS[node.label])
    nodeIds.add(node.id)
  }

  const edgeColors = new Map<string, string>()
  const seenEdges = new Set<string>()
  for (const edge of edges) {
    const key = edgeKey(edge.source, edge.target)
    if (seenEdges.has(key))
      continue
    seenEdges.add(key)
    edgeColors.set(key, EDGE_COLOR)
  }

  if (!highlightedId || !nodeIds.has(highlightedId))
    return { nodeColors, edgeColors }

  const full = new Set<string>([highlightedId])
  for (const edge of edges) {
    if (edge.source === highlightedId)
      full.add(edge.target)
    if (edge.target === highlightedId)
      full.add(edge.source)
  }

  const dimmedNodeColors = new Map<string, string>()
  for (const [id, color] of nodeColors) {
    dimmedNodeColors.set(id, full.has(id) ? color : withAlpha(color, 0.2))
  }

  const dimmedEdgeColors = new Map<string, string>()
  for (const [key, color] of edgeColors) {
    const edge = edges.find(e => edgeKey(e.source, e.target) === key)
    const incident = edge && (edge.source === highlightedId || edge.target === highlightedId)
    dimmedEdgeColors.set(key, incident ? color : withAlpha(color, 0.2))
  }

  return { nodeColors: dimmedNodeColors, edgeColors: dimmedEdgeColors }
}

/**
 * Apply the effective colors from `computeHighlightColors` onto a graphology
 * graph. This is the only graphology-coupled step; the color computation is
 * pure.
 */
export function applyHighlightColors(
  graph: Graph,
  nodeColors: Map<string, string>,
  edgeColors: Map<string, string>,
): void {
  for (const [id, color] of nodeColors) {
    if (graph.hasNode(id))
      graph.setNodeAttribute(id, 'color', color)
  }

  const edgeKeyToId = new Map<string, string>()
  graph.forEachEdge((edgeId, _attrs, source, target) => {
    edgeKeyToId.set(edgeKey(source, target), edgeId)
  })

  for (const [key, color] of edgeColors) {
    const edgeId = edgeKeyToId.get(key)
    if (edgeId)
      graph.setEdgeAttribute(edgeId, 'color', color)
  }
}

/**
 * Small stateful wrapper that owns the current node/edge payload and the
 * highlighted id, then applies the effective colors to a graphology graph.
 */
export class HighlightOverlay {
  private highlightedId: string | null = null
  private nodes: GraphNode[] = []
  private edges: GraphEdge[] = []

  setPayload(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes = nodes
    this.edges = edges
  }

  highlight(nodeId: string | null): void {
    this.highlightedId = nodeId
  }

  applyToGraph(graph: Graph): void {
    const { nodeColors, edgeColors } = computeHighlightColors(this.nodes, this.edges, this.highlightedId)
    applyHighlightColors(graph, nodeColors, edgeColors)
  }
}
