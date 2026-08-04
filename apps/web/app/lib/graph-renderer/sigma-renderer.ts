import type { SigmaSurface, SigmaSurfaceFactory } from './sigma-surface'
import type { GraphEdge, GraphNode, GraphRenderer } from './types'
import { computeCameraFit } from './sigma-graph'
import { SigmaGraphStore } from './sigma-graph-store'
import { createSigmaSurface } from './sigma-surface'

/**
 * sigma.js (WebGL) implementation of `GraphRenderer`.
 *
 * sigma is intentionally NOT statically imported: its module-level code
 * touches `WebGL2RenderingContext`, which throws in a Node/SSR context, so
 * the surface instance is created client-side inside `mount()` only. The
 * graphology and layout code is owned by `SigmaGraphStore` and is pure JS,
 * safe to import anywhere.
 *
 * sigma v3 removed the v2 node/edge reducer API; highlight is implemented by
 * mutating node/edge `color` attributes on the graphology graph and calling
 * `refresh()`, which is sigma v3's supported dynamic-styling path.
 */
export class SigmaRenderer implements GraphRenderer {
  private surface: SigmaSurface | null = null
  private surfaceFactory: SigmaSurfaceFactory
  private graphStore: SigmaGraphStore
  private clickHandler: ((node: GraphNode) => void) | null = null
  private pendingNodes: GraphNode[] | null = null
  private pendingEdges: GraphEdge[] | null = null

  constructor(surfaceFactory: SigmaSurfaceFactory = createSigmaSurface) {
    this.surfaceFactory = surfaceFactory
    this.graphStore = new SigmaGraphStore()
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.surface)
      return

    const surface = await this.surfaceFactory(this.graphStore.graph, container)
    this.surface = surface

    surface.onClickNode((node) => {
      if (!this.clickHandler)
        return
      const nodeData = this.graphStore.getNodeData(node)
      if (nodeData)
        this.clickHandler(nodeData)
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
  }

  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.surface) {
      this.pendingNodes = nodes
      this.pendingEdges = edges
      return
    }

    const graph = this.graphStore.replace(nodes, edges)
    this.surface.setGraph(graph)
    this.fitCamera()
    this.surface.refresh()
  }

  highlight(nodeId: string | null): void {
    this.graphStore.applyHighlight(nodeId)
    this.surface?.refresh()
  }

  onNodeClick(cb: (node: GraphNode) => void): void {
    this.clickHandler = cb
  }

  destroy(): void {
    if (this.surface) {
      this.surface.kill()
      this.surface = null
    }
    this.clickHandler = null
    this.pendingNodes = null
    this.pendingEdges = null
  }

  private applyHighlight(): void {
    this.graphStore.applyHighlight()
    this.surface?.refresh()
  }

  private fitCamera(): void {
    if (!this.surface)
      return

    this.surface.getCamera().setState(computeCameraFit())
  }
}
