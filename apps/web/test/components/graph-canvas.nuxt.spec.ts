import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import GraphCanvas from '../../app/components/graph/graph-canvas.vue'

const { cytoscapeFactory, tapNode } = vi.hoisted(() => {
  let tapHandler: ((evt: { target: { data: () => Record<string, unknown> } }) => void) | null = null
  const instance = {
    on: vi.fn((event: string, _selector: string, handler: (evt: any) => void) => {
      if (event === 'tap')
        tapHandler = handler
    }),
    elements: vi.fn(() => ({
      removeStyle: vi.fn(),
      remove: vi.fn(),
      add: vi.fn(),
      difference: vi.fn(() => ({ style: vi.fn() })),
    })),
    getElementById: vi.fn(() => ({ length: 0 })),
    add: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    destroy: vi.fn(),
  }
  const cytoscapeFactory = vi.fn(() => instance)
  cytoscapeFactory.use = vi.fn()
  return {
    cytoscapeFactory,
    tapNode: (data: Record<string, unknown>) => tapHandler?.({ target: { data: () => data } }),
  }
})

vi.mock('cytoscape', () => ({ default: cytoscapeFactory }))
vi.mock('cytoscape-fcose', () => ({ default: vi.fn() }))

describe('graph-canvas', () => {
  it('renders a color legend explaining node types', async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: [
          { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
          { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
          { id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' },
        ],
        edges: [],
        selectedNodeId: null,
      },
    })

    const legend = component.find('[data-testid="graph-legend"]')
    expect(legend.exists()).toBe(true)
    expect(legend.findAll('li')).toHaveLength(3)

    const html = component.html()
    expect(html).toContain('Topic')
    expect(html).toContain('Concept')
    expect(html).toContain('Note')
  })

  it('emits selectNode carrying syncedFolderId when a note node is tapped', async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: [
          { id: 'n1', label: 'Note', name: 'Note A', ref: '/vault/a.md', syncedFolderId: 'sf-1' },
        ],
        edges: [],
        selectedNodeId: null,
      },
    })
    await flushPromises()

    tapNode({ id: 'n1', label: 'Note', name: 'Note A', ref: '/vault/a.md', syncedFolderId: 'sf-1' })

    expect(component.emitted('selectNode')).toBeTruthy()
    expect(component.emitted('selectNode')![0]![0]).toMatchObject({
      id: 'n1',
      label: 'Note',
      name: 'Note A',
      ref: '/vault/a.md',
      syncedFolderId: 'sf-1',
    })
  })

  it('emits selectNode without syncedFolderId for notes lacking one', async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: [
          { id: 'n2', label: 'Note', name: 'Plain', ref: '/notes/plain.md' },
        ],
        edges: [],
        selectedNodeId: null,
      },
    })
    await flushPromises()

    tapNode({ id: 'n2', label: 'Note', name: 'Plain', ref: '/notes/plain.md' })

    const payload = component.emitted('selectNode')![0]![0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 'n2', label: 'Note', name: 'Plain', ref: '/notes/plain.md' })
    expect(payload).not.toHaveProperty('syncedFolderId')
  })
})
