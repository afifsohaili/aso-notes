import type { GraphEdge, GraphNode, GraphRenderer } from './types'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'

/**
 * Node colors must match the legend rendered by `graph-canvas.vue`.
 */
const NODE_COLORS: Record<GraphNode['label'], string> = {
  Topic: '#7c3aed',
  Concept: '#4f46e5',
  Note: '#059669',
  Tag: '#d97706',
}

/**
 * Node sizes (px radius in sigma) — Topic > Concept > Note > Tag.
 */
const NODE_SIZES: Record<GraphNode['label'], number> = {
  Topic: 12,
  Concept: 8,
  Note: 6,
  Tag: 5,
}

/** Muted edge styling, close to the cytoscape renderer's edge color. */
const EDGE_COLOR = '#94a3b8'
const EDGE_SIZE = 1.5

/**
 * Labels render only once a node is big enough on screen. This is an
 * intentional improvement over the cytoscape renderer (labels always on):
 * the overview stays uncluttered and labels fade in when zoomed.
 */
const LABEL_RENDERED_SIZE_THRESHOLD = 8

/**
 * Bounded synchronous FA2 run — the ego-graph overview is a few hundred
 * nodes at most, so a main-thread assign is acceptable.
 */
const FA2_ITERATIONS = 150

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * sigma.js (WebGL) implementation of `GraphRenderer`.
 *
 * sigma is intentionally NOT statically imported: its module-level code
 * touches `WebGL2RenderingContext`, which throws in a Node/SSR context, so
 * the instance is created client-side inside `mount()` only. graphology and
 * the layout algorithms are pure JS and safe to import anywhere.
 *
 * sigma v3 removed the v2 node/edge reducer API; highlight is implemented by
 * mutating node/edge `color` attributes on the graphology graph and calling
 * `sigma.refresh()`, which is sigma v3's supported dynamic-styling path.
 */
export class SigmaRenderer implements GraphRenderer {
  private graph: Graph
  private sigma: any = null
  private clickHandler: ((node: GraphNode) => void) | null = null
  private highlightedNodeId: string | null = null

  constructor() {
    // Undirected is fine: graph edges are bidirectional for layout purposes.
    // The edge `type` is kept in the attributes.
    this.graph = new Graph({ type: 'undirected' })
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.sigma)
      return
    const { default: Sigma } = await import('sigma')

    this.sigma = new Sigma(this.graph, container, {
      labelRenderedSizeThreshold: LABEL_RENDERED_SIZE_THRESHOLD,
    })

    this.sigma.on('clickNode', ({ node }: { node: string }) => {
      if (!this.clickHandler)
        return
      const nodeData = this.graph.getNodeAttribute(node, 'nodeData')
      if (nodeData)
        this.clickHandler(nodeData as GraphNode)
    })

    // Initial render of the (empty) graph; resolves once sigma is ready to
    // receive data via setGraph().
    this.sigma.refresh()
  }

  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.sigma)
      return

    this.graph.clear()
    for (const node of nodes) {
      this.graph.addNode(node.id, {
        label: node.name,
        size: NODE_SIZES[node.label],
        color: NODE_COLORS[node.label],
        baseColor: NODE_COLORS[node.label],
        nodeData: node,
      })
    }
    for (const edge of edges) {
      // The API guarantees edges reference existing nodes; skip defensively
      // so a bad payload can't crash the renderer.
      if (!this.graph.hasNode(edge.source) || !this.graph.hasNode(edge.target))
        continue
      this.graph.addEdge(edge.source, edge.target, {
        type: edge.type,
        color: EDGE_COLOR,
        baseColor: EDGE_COLOR,
        size: EDGE_SIZE,
      })
    }

    this.runLayout()
    this.applyHighlight()
  }

  highlight(nodeId: string | null): void {
    this.highlightedNodeId = nodeId
    this.applyHighlight()
  }

  onNodeClick(cb: (node: GraphNode) => void): void {
    this.clickHandler = cb
  }

  destroy(): void {
    if (this.sigma) {
      this.sigma.kill()
      this.sigma = null
    }
    this.clickHandler = null
    this.highlightedNodeId = null
    this.graph.clear()
  }

  /** Seed positions on a circle, then settle them with a bounded FA2 run. */
  private runLayout(): void {
    circular.assign(this.graph, { scale: 1 })
    forceAtlas2.assign(this.graph, {
      iterations: FA2_ITERATIONS,
      settings: forceAtlas2.inferSettings(this.graph),
    })
  }

  /**
   * Dim everything except the highlighted node and its 1-hop neighborhood
   * (mirrors the cytoscape renderer, which keeps `selected + neighborhood()`
   * at full opacity). Edges keep full opacity only when incident to the
   * highlighted node — matching cytoscape, where `neighborhood()` on a node
   * covers its incident edges.
   */
  private applyHighlight(): void {
    if (!this.sigma)
      return
    const id = this.highlightedNodeId

    if (!id || !this.graph.hasNode(id)) {
      this.graph.forEachNode((node) => {
        this.graph.setNodeAttribute(node, 'color', this.graph.getNodeAttribute(node, 'baseColor'))
      })
      this.graph.forEachEdge((edge) => {
        this.graph.setEdgeAttribute(edge, 'color', this.graph.getEdgeAttribute(edge, 'baseColor'))
      })
    }
    else {
      const full = new Set<string>([id, ...this.graph.neighbors(id)])
      this.graph.forEachNode((node, attrs) => {
        const baseColor = attrs.baseColor ?? attrs.color
        this.graph.setNodeAttribute(
          node,
          'color',
          full.has(node) ? baseColor : withAlpha(baseColor, 0.2),
        )
      })
      this.graph.forEachEdge((edge, attrs, source, target) => {
        const baseColor = attrs.baseColor ?? attrs.color
        this.graph.setEdgeAttribute(
          edge,
          'color',
          source === id || target === id ? baseColor : withAlpha(baseColor, 0.2),
        )
      })
    }

    this.sigma.refresh()
  }
}
