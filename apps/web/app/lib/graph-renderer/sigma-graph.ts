import type { GraphEdge, GraphNode } from './types'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { EDGE_COLOR, EDGE_SIZE, FA2_ITERATIONS, NODE_COLORS, NODE_SIZES } from './constants'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Circular seed coordinates so every node has numeric x/y at add time. */
function circularSeed(index: number, count: number): { x: number, y: number } {
  const safeCount = Math.max(count, 1)
  const angle = (2 * Math.PI * index) / safeCount
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/**
 * Build a fresh graphology graph from nodes and edges, seeding each node with
 * numeric x/y coordinates before it is added. Sigma refreshes synchronously
 * when nodes are added, so x/y must exist at add time; the circular + FA2
 * layout later refines these seed positions.
 */
export function buildGraphologyGraph(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  const graph = new Graph({ type: 'undirected' })
  populateGraphologyGraph(graph, nodes, edges)
  return graph
}

/**
 * Populate an existing graphology graph. Used by the sigma renderer so the
 * graph instance bound to sigma can be reused across `setGraph()` calls.
 */
export function populateGraphologyGraph(graph: Graph, nodes: GraphNode[], edges: GraphEdge[]): void {
  graph.clear()

  const count = nodes.length
  nodes.forEach((node, index) => {
    const { x, y } = circularSeed(index, count)
    graph.addNode(node.id, {
      x,
      y,
      label: node.name,
      size: NODE_SIZES[node.label],
      color: NODE_COLORS[node.label],
      baseColor: NODE_COLORS[node.label],
      nodeData: node,
    })
  })

  for (const edge of edges) {
    // The API guarantees edges reference existing nodes; skip defensively
    // so a bad payload cannot crash the renderer.
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target))
      continue
    // Real workspace data can contain duplicate undirected pairs (e.g. A→B and
    // B→A rows, or multiple relation types between the same concept pair). The
    // graph is non-multi, so the first edge wins and the rest are ignored.
    if (graph.hasEdge(edge.source, edge.target))
      continue
    graph.addEdge(edge.source, edge.target, {
      edgeType: edge.type,
      color: EDGE_COLOR,
      baseColor: EDGE_COLOR,
      size: EDGE_SIZE,
    })
  }
}

/** Seed positions on a circle, then settle them with a bounded FA2 run. */
export function runLayout(graph: Graph): void {
  circular.assign(graph, { scale: 1 })
  forceAtlas2.assign(graph, {
    iterations: FA2_ITERATIONS,
    settings: forceAtlas2.inferSettings(graph),
  })
}

/**
 * Compute a sigma v3 camera state in NORMALIZED coordinates.
 *
 * Sigma v3 internally normalizes all node positions to the unit square:
 *   x' = 0.5 + (x - bboxCenterX) / max(bboxW, bboxH)
 * and the camera operates on those normalized coordinates. The default camera
 * `{x: 0.5, y: 0.5, ratio: 1}` already frames the entire graph. Padding is
 * achieved by zooming out with ratio > 1.
 *
 * Returns `{x: 0.5, y: 0.5, ratio: 1 / (1 - 2 * padding)}`. Padding is clamped
 * to [0, 0.45] so the ratio stays finite.
 *
 * See sigma v3 source: `normalization-*.cjs.dev.js` and `matrixFromCamera`.
 */
export function computeCameraFit(padding = 0.1): { x: 0.5, y: 0.5, ratio: number } {
  const safePadding = Math.min(Math.max(padding, 0), 0.45)
  return { x: 0.5, y: 0.5, ratio: 1 / (1 - 2 * safePadding) }
}

/**
 * Dim everything except the highlighted node and its 1-hop neighborhood
 * (mirrors the cytoscape renderer, which keeps `selected + neighborhood()`
 * at full opacity). Edges keep full opacity only when incident to the
 * highlighted node — matching cytoscape, where `neighborhood()` on a node
 * covers its incident edges.
 *
 * This is a pure graphology operation; callers (e.g. the sigma renderer) must
 * refresh their own rendering surface afterwards.
 */
export function applyHighlightToGraph(graph: Graph, highlightedNodeId: string | null): void {
  if (!highlightedNodeId || !graph.hasNode(highlightedNodeId)) {
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'color', graph.getNodeAttribute(node, 'baseColor'))
    })
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, 'color', graph.getEdgeAttribute(edge, 'baseColor'))
    })
    return
  }

  const full = new Set<string>([highlightedNodeId, ...graph.neighbors(highlightedNodeId)])
  graph.forEachNode((node, attrs) => {
    const baseColor = attrs.baseColor ?? attrs.color
    graph.setNodeAttribute(
      node,
      'color',
      full.has(node) ? baseColor : withAlpha(baseColor, 0.2),
    )
  })
  graph.forEachEdge((edge, attrs, source, target) => {
    const baseColor = attrs.baseColor ?? attrs.color
    graph.setEdgeAttribute(
      edge,
      'color',
      source === highlightedNodeId || target === highlightedNodeId ? baseColor : withAlpha(baseColor, 0.2),
    )
  })
}
