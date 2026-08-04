import type { GraphEdge, GraphNode } from './types'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { EDGE_COLOR, EDGE_SIZE, FA2_ITERATIONS, NODE_COLORS, NODE_SIZES } from './constants'

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

  return graph
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
