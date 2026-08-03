import type { GraphEdge, GraphNode, GraphRenderer } from './types'
import Graph from 'graphology'
import {
  applyHighlightToGraph,
  computeCameraFit,
  LABEL_RENDERED_SIZE_THRESHOLD,
  populateGraphologyGraph,
  runLayout,
} from './sigma-graph'

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
 *
 * Graph construction, layout, camera framing and highlight logic are factored
 * into `sigma-graph.ts` so they can be tested against the real graphology +
 * layout libraries without mocking the WebGL surface.
 */
export class SigmaRenderer implements GraphRenderer {
  private graph: Graph
  private sigma: any = null
  private container: HTMLElement | null = null
  private clickHandler: ((node: GraphNode) => void) | null = null
  private highlightedNodeId: string | null = null
  private pendingNodes: GraphNode[] | null = null
  private pendingEdges: GraphEdge[] | null = null

  constructor() {
    // Undirected is fine: graph edges are bidirectional for layout purposes.
    // The edge `type` is kept in the attributes.
    this.graph = new Graph({ type: 'undirected' })
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.sigma)
      return

    this.container = container
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

    // Apply any data that arrived while sigma was still being imported.
    if (this.pendingNodes !== null && this.pendingEdges !== null) {
      this.setGraph(this.pendingNodes, this.pendingEdges)
    }
    else {
      this.applyHighlight()
    }

    this.pendingNodes = null
    this.pendingEdges = null

    // Initial render of the (now possibly populated) graph.
    this.sigma.refresh()
  }

  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.sigma) {
      this.pendingNodes = nodes
      this.pendingEdges = edges
      return
    }

    populateGraphologyGraph(this.graph, nodes, edges)
    runLayout(this.graph)
    this.fitCamera()
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
    this.pendingNodes = null
    this.pendingEdges = null
    this.container = null
    this.graph.clear()
  }

  private applyHighlight(): void {
    if (!this.sigma)
      return

    applyHighlightToGraph(this.graph, this.highlightedNodeId)
    this.sigma.refresh()
  }

  private fitCamera(): void {
    if (!this.sigma || !this.container)
      return

    const rect = this.container.getBoundingClientRect()
    const fit = computeCameraFit(this.graph, rect.width, rect.height)
    if (!fit)
      return

    this.sigma.getCamera().setState(fit)
  }
}
