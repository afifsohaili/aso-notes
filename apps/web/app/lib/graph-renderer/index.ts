import type { GraphRendererImpl } from './config'
import type { GraphRenderer } from './types'
import { GRAPH_RENDERER_IMPLS } from './config'
import { CytoscapeRenderer } from './cytoscape-renderer'
import { SigmaRenderer } from './sigma-renderer'

export { GRAPH_RENDERER_IMPLS, resolveGraphRenderer } from './config'
export type { GraphRendererImpl } from './config'
export type { GraphEdge, GraphNode, GraphRenderer } from './types'

/**
 * Renderer implementations currently registered behind the seam.
 *
 * The active implementation is selected at runtime via
 * `NUXT_PUBLIC_GRAPH_RENDERER` (resolved by `resolveGraphRenderer`), defaulting
 * to sigma (WebGL). Both implementations share the same `GraphRenderer`
 * contract.
 */
export function createGraphRenderer(impl: string): GraphRenderer {
  if (!GRAPH_RENDERER_IMPLS.includes(impl as GraphRendererImpl))
    throw new Error(`Unknown graph renderer implementation: ${impl}`)

  const resolved = impl as GraphRendererImpl
  switch (resolved) {
    case 'cytoscape':
      return new CytoscapeRenderer()
    case 'sigma':
      return new SigmaRenderer()
  }
}
