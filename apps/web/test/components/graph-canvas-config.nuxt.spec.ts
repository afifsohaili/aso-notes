import type { GraphRenderer } from '../../app/lib/graph-renderer/types'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import GraphCanvas from '../../app/components/graph/graph-canvas.vue'

const { createGraphRendererMock } = vi.hoisted(() => ({
  createGraphRendererMock: vi.fn(),
}))

vi.mock('../../app/lib/graph-renderer', () => ({
  createGraphRenderer: createGraphRendererMock,
  GRAPH_RENDERER_IMPLS: ['cytoscape', 'sigma'],
}))

const fakeRenderer: GraphRenderer = {
  mount: vi.fn().mockResolvedValue(undefined),
  setGraph: vi.fn(),
  highlight: vi.fn(),
  onNodeClick: vi.fn(),
  destroy: vi.fn(),
}

describe('graph-canvas renderer selection', () => {
  it('passes the runtime-config renderer to the factory (sigma default)', async () => {
    createGraphRendererMock.mockReturnValue(fakeRenderer)

    await mountSuspended(GraphCanvas, {
      props: { nodes: [], edges: [], selectedNodeId: null },
    })
    await flushPromises()

    expect(createGraphRendererMock).toHaveBeenCalledWith('sigma')
  })
})
