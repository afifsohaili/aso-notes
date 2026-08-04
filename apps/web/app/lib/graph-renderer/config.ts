/**
 * Renderer selection from runtime config.
 *
 * `NUXT_PUBLIC_GRAPH_RENDERER` gates which `GraphRenderer` implementation
 * the graph page uses. Only `'sigma'` and `'cytoscape'` are valid; anything
 * else (including an unset value) falls back to the sigma (WebGL) renderer.
 */
export const GRAPH_RENDERER_IMPLS = ['cytoscape', 'sigma'] as const

export type GraphRendererImpl = typeof GRAPH_RENDERER_IMPLS[number]

const VALID: GraphRendererImpl[] = [...GRAPH_RENDERER_IMPLS]

export function resolveGraphRenderer(value: unknown): GraphRendererImpl {
  return VALID.includes(value as GraphRendererImpl) ? (value as GraphRendererImpl) : 'sigma'
}
