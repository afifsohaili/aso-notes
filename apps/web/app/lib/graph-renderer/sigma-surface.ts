import type Graph from 'graphology'
import { LABEL_RENDERED_SIZE_THRESHOLD } from './constants'

/**
 * The subset of sigma v3 that the renderer actually uses. Hiding the full
 * Sigma class behind this narrow interface keeps the renderer testable without
 * a DOM / WebGL context and gives us a single seam for sigma upgrades.
 */
export interface SigmaSurface {
  setGraph: (graph: Graph) => void
  refresh: () => void
  kill: () => void
  getCamera: () => {
    setState: (state: { x: number, y: number, ratio: number }) => void
  }
  onClickNode: (handler: (node: string) => void) => void
}

/**
 * Factory that creates the browser-only sigma surface. sigma is dynamically
 * imported so its module-level WebGL touches do not run during SSR / Node
 * tests.
 */
export type SigmaSurfaceFactory = (graph: Graph, container: HTMLElement) => Promise<SigmaSurface> | SigmaSurface

export async function createSigmaSurface(graph: Graph, container: HTMLElement): Promise<SigmaSurface> {
  const { default: Sigma } = await import('sigma')
  const sigma = new Sigma(graph, container, {
    labelRenderedSizeThreshold: LABEL_RENDERED_SIZE_THRESHOLD,
  })

  return {
    setGraph: (g: Graph) => sigma.setGraph(g),
    refresh: () => sigma.refresh(),
    kill: () => sigma.kill(),
    getCamera: () => sigma.getCamera(),
    onClickNode: (handler) => {
      sigma.on('clickNode', ({ node }: { node: string }) => handler(node))
    },
  }
}
