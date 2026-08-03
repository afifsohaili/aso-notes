/**
 * Shared types and the renderer seam for the graph page.
 *
 * `GraphNode` / `GraphEdge` mirror the graph API response shapes
 * (`server/lib/graph/ui.ts`) so API payloads can be handed to a renderer
 * as-is. Renderer implementations (Cytoscape today, sigma.js later) only
 * ever talk through `GraphRenderer`; swapping one for the other is a factory
 * decision.
 */

export interface GraphNode {
  id: string
  label: 'Concept' | 'Note' | 'Tag' | 'Topic'
  name: string
  ref: string
}

export interface GraphEdge {
  source: string
  target: string
  type: 'RELATES_TO' | 'MENTIONS' | 'TAGGED' | 'LINKS' | 'GROUPED_UNDER'
  edgeType?: string
}

/**
 * Contract between the graph page and a concrete graph renderer.
 *
 * `setGraph` is a full replacement: the renderer drops its current elements
 * and lays out the new graph from scratch (merges happen at the page level,
 * Phase 4).
 */
export interface GraphRenderer {
  mount: (container: HTMLElement) => Promise<void>
  setGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void
  highlight: (nodeId: string | null) => void
  onNodeClick: (cb: (node: GraphNode) => void) => void
  destroy: () => void
}
