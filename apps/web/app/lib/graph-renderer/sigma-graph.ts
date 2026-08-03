import type { GraphEdge, GraphNode } from './types'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'

/**
 * Node colors must match the legend rendered by `graph-canvas.vue`.
 */
export const NODE_COLORS: Record<GraphNode['label'], string> = {
  Topic: '#7c3aed',
  Concept: '#4f46e5',
  Note: '#059669',
  Tag: '#d97706',
}

/**
 * Node sizes (px radius in sigma) — Topic > Concept > Note > Tag.
 */
export const NODE_SIZES: Record<GraphNode['label'], number> = {
  Topic: 12,
  Concept: 8,
  Note: 6,
  Tag: 5,
}

/** Muted edge styling, close to the cytoscape renderer's edge color. */
export const EDGE_COLOR = '#94a3b8'
export const EDGE_SIZE = 1.5

/**
 * Labels render only once a node is big enough on screen. This is an
 * intentional improvement over the cytoscape renderer (labels always on):
 * the overview stays uncluttered and labels fade in when zoomed.
 */
export const LABEL_RENDERED_SIZE_THRESHOLD = 8

/**
 * Bounded synchronous FA2 run — the ego-graph overview is a few hundred
 * nodes at most, so a main-thread assign is acceptable.
 */
export const FA2_ITERATIONS = 150

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
 * Compute a sigma v3 camera state that fits the graph's bounding box into the
 * given container with a padding margin. Sigma's camera semantics:
 *   visible width  = ratio * containerWidth / minSide
 *   visible height = ratio * containerHeight / minSide
 * where minSide = min(containerWidth, containerHeight).
 *
 * Returns null for an empty graph. A zero-size bounding box (single node or all
 * nodes at the same position) returns ratio 1 so the camera still frames the
 * center point.
 */
export function computeCameraFit(
  graph: Graph,
  containerWidth: number,
  containerHeight: number,
  padding = 0.1,
): { x: number, y: number, ratio: number } | null {
  if (graph.order === 0)
    return null

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  graph.forEachNode((_node, attrs) => {
    minX = Math.min(minX, attrs.x as number)
    maxX = Math.max(maxX, attrs.x as number)
    minY = Math.min(minY, attrs.y as number)
    maxY = Math.max(maxY, attrs.y as number)
  })

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const bboxWidth = maxX - minX
  const bboxHeight = maxY - minY
  const minSide = Math.min(containerWidth, containerHeight)

  // Zero-size (or degenerate) bbox: frame the center with a default zoom.
  if (bboxWidth === 0 || bboxHeight === 0 || minSide <= 0)
    return { x: centerX, y: centerY, ratio: 1 }

  const paddedWidth = bboxWidth / (1 - 2 * padding)
  const paddedHeight = bboxHeight / (1 - 2 * padding)

  const ratio = Math.max(
    (paddedWidth * minSide) / containerWidth,
    (paddedHeight * minSide) / containerHeight,
  )

  return { x: centerX, y: centerY, ratio }
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
