/**
 * Renderer selection from runtime config.
 *
 * `NUXT_PUBLIC_GRAPH_RENDERER` gates which `GraphRenderer` implementation
 * the graph page uses. Only `'sigma'` and `'cytoscape'` are valid; anything
 * else (including an unset value) falls back to the WebGL renderer.
 */
export type GraphRendererImpl = 'sigma' | 'cytoscape'

const VALID: GraphRendererImpl[] = ['sigma', 'cytoscape']

export function resolveGraphRenderer(value: unknown): GraphRendererImpl {
  return VALID.includes(value as GraphRendererImpl) ? (value as GraphRendererImpl) : 'sigma'
}
