import type { SigmaSurface, SigmaSurfaceFactory } from './sigma-surface'
import type { GraphEdge, GraphNode, GraphRenderer } from './types'
import { computeCameraFit } from './sigma-graph'
import { SigmaGraphStore } from './sigma-graph-store'
import { createSigmaSurface } from './sigma-surface'

type SigmaOp
  = | { type: 'setGraph', nodes: GraphNode[], edges: GraphEdge[] }
    | { type: 'highlight', id: string | null }

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
 *
 * All renderer mutations are serialized through a single in-memory op queue.
 * Operations enqueued before mount drain once the surface is ready, preserving
 * the order requested by the page.
 */
export class SigmaRenderer implements GraphRenderer {
  private surface: SigmaSurface | null = null
  private surfaceFactory: SigmaSurfaceFactory
  private graphStore: SigmaGraphStore
  private clickHandler: ((node: GraphNode) => void) | null = null
  private queue: SigmaOp[] = []

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

    const queueWasEmpty = this.queue.length === 0
    this.drain()
    if (queueWasEmpty)
      surface.refresh()
  }

  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.queue.push({ type: 'setGraph', nodes, edges })
    this.drain()
  }

  highlight(nodeId: string | null): void {
    this.queue.push({ type: 'highlight', id: nodeId })
    this.drain()
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
    this.queue = []
  }

  private drain(): void {
    while (this.surface && this.queue.length > 0) {
      const op = this.queue.shift()!
      if (op.type === 'setGraph')
        this.executeSetGraph(op.nodes, op.edges)
      else
        this.executeHighlight(op.id)
    }
  }

  private executeSetGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.surface)
      return
    const graph = this.graphStore.replace(nodes, edges)
    this.surface.setGraph(graph)
    this.surface.getCamera().setState(computeCameraFit())
    this.surface.refresh()
  }

  private executeHighlight(nodeId: string | null): void {
    if (!this.surface)
      return
    this.graphStore.applyHighlight(nodeId)
    this.surface.refresh()
  }
}
