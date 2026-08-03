import type { GraphRenderer } from './types'
import { CytoscapeRenderer } from './cytoscape-renderer'
import { SigmaRenderer } from './sigma-renderer'

export type { GraphEdge, GraphNode, GraphRenderer } from './types'

/**
 * Renderer implementations currently registered behind the seam.
 * Runtime-config-driven selection (e.g. `public.graphRenderer`) lands in
 * Phase 4; the page hardcodes `'cytoscape'` for now.
 */
export const GRAPH_RENDERER_IMPLS = ['cytoscape', 'sigma'] as const

export function createGraphRenderer(impl: string): GraphRenderer {
  switch (impl) {
    case 'cytoscape':
      return new CytoscapeRenderer()
    case 'sigma':
      return new SigmaRenderer()
    default:
      throw new Error(`Unknown graph renderer implementation: ${impl}`)
  }
}
