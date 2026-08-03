import type { GraphEdge, GraphNode, GraphRenderer } from '../../app/lib/graph-renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGraphRenderer } from '../../app/lib/graph-renderer'

// --- Mock cytoscape at the system boundary --------------------------------
// The renderer dynamically imports cytoscape + cytoscape-fcose inside
// mount(); replacing those modules here lets us observe the renderer's
// contract without a browser canvas.

const mock = vi.hoisted(() => {
  const state: {
    cytoscape: any
    use: any
    lastCy: any
    tapHandler: ((evt: any) => void) | null
  } = {
    cytoscape: null,
    use: null,
    lastCy: null,
    tapHandler: null,
  }

  const makeCollection = () => {
    const collection: any = {
      length: 0,
      remove: vi.fn(),
      removeStyle: vi.fn(),
      style: vi.fn(),
      difference: vi.fn(),
      neighborhood: vi.fn(),
      add: vi.fn(),
    }
    collection.difference.mockReturnValue(collection)
    collection.neighborhood.mockReturnValue(collection)
    collection.add.mockReturnValue(collection)
    return collection
  }

  const makeCy = () => {
    // one live collection shared by every cy.elements() call, like real cytoscape
    const collection = makeCollection()
    const layout = {
      run: vi.fn(),
      promiseOn: vi.fn(() => Promise.resolve()),
    }
    const cy: any = {
      on: vi.fn((event: string, selector: string, handler: any) => {
        if (event === 'tap' && selector === 'node')
          state.tapHandler = handler
      }),
      elements: vi.fn(() => collection),
      add: vi.fn(),
      layout: vi.fn(() => layout),
      getElementById: vi.fn(() => makeCollection()),
      destroy: vi.fn(),
    }
    return cy
  }

  const cytoscape = vi.fn(() => {
    state.lastCy = makeCy()
    return state.lastCy
  })
  state.cytoscape = cytoscape
  state.use = vi.fn()
  cytoscape.use = state.use

  return { state, makeCollection }
})

vi.mock('cytoscape', () => ({ default: mock.state.cytoscape }))
vi.mock('cytoscape-fcose', () => ({ default: { name: 'fcose' } }))

// --- Fixtures -------------------------------------------------------------

const NODES: GraphNode[] = [
  { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
  { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
]

const EDGES: GraphEdge[] = [
  { source: 'c1', target: 't1', type: 'GROUPED_UNDER' },
]

// --- Tests ----------------------------------------------------------------

describe('createGraphRenderer', () => {
  beforeEach(() => {
    mock.state.cytoscape.mockClear()
    mock.state.use.mockClear()
    mock.state.lastCy = null
    mock.state.tapHandler = null
  })

  it('returns a renderer implementing the full GraphRenderer contract', async () => {
    const renderer = createGraphRenderer('cytoscape')

    expect(typeof renderer.mount).toBe('function')
    expect(typeof renderer.setGraph).toBe('function')
    expect(typeof renderer.highlight).toBe('function')
    expect(typeof renderer.onNodeClick).toBe('function')
    expect(typeof renderer.destroy).toBe('function')

    await renderer.mount({} as HTMLElement)
    expect(mock.state.cytoscape).toHaveBeenCalledTimes(1)
    expect(mock.state.use).toHaveBeenCalledTimes(1)

    renderer.destroy()
    expect(mock.state.lastCy.destroy).toHaveBeenCalled()
  })

  it('throws for an unknown implementation', () => {
    expect(() => createGraphRenderer('paperjs')).toThrow(/Unknown graph renderer implementation: paperjs/)
  })
})

describe('cytoscape renderer contract', () => {
  let renderer: GraphRenderer
  let cy: any

  beforeEach(() => {
    mock.state.cytoscape.mockClear()
    mock.state.use.mockClear()
    mock.state.lastCy = null
    mock.state.tapHandler = null
    renderer = createGraphRenderer('cytoscape')
  })

  async function mountRenderer() {
    await renderer.mount({} as HTMLElement)
    cy = mock.state.lastCy
    expect(cy).toBeTruthy()
  }

  function setFoundNode(id: string) {
    cy.getElementById.mockImplementation((query: string) => {
      const collection = mock.makeCollection()
      collection.length = query === id ? 1 : 0
      return collection
    })
  }

  it('mount creates a cytoscape instance and wires the tap handler', async () => {
    await mountRenderer()

    const config = mock.state.cytoscape.mock.calls[0][0]
    expect(config.container).toBeDefined()
    expect(config.elements).toEqual([])
    expect(Array.isArray(config.style)).toBe(true)
    expect(config.style.length).toBeGreaterThan(0)

    expect(mock.state.use).toHaveBeenCalledWith({ name: 'fcose' })
    expect(cy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
  })

  it('setGraph replaces elements and re-runs the layout', async () => {
    await mountRenderer()
    const layoutsBefore = cy.layout.mock.calls.length

    renderer.setGraph(NODES, EDGES)

    // old elements are dropped, new ones added
    expect(cy.elements().remove).toHaveBeenCalled()
    const added = cy.add.mock.calls[0][0]
    expect(added).toHaveLength(3)

    expect(added).toEqual([
      { data: { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1', color: '#7c3aed' } },
      { data: { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1', color: '#4f46e5' } },
      { data: { id: 'c1-t1-GROUPED_UNDER', source: 'c1', target: 't1', type: 'GROUPED_UNDER' } },
    ])

    // layout re-ran for the new data (mount already ran one on the empty graph)
    expect(cy.layout.mock.calls.length).toBeGreaterThan(layoutsBefore)
    const layout = cy.layout.mock.results[cy.layout.mock.results.length - 1].value
    expect(layout.run).toHaveBeenCalled()
    expect(layout.promiseOn).toHaveBeenCalledWith('layoutstop')
  })

  it('highlight dims everything outside the node neighborhood', async () => {
    await mountRenderer()
    setFoundNode('c1')
    const collection = cy.elements()

    renderer.highlight('c1')

    expect(collection.removeStyle).toHaveBeenCalled()
    expect(cy.getElementById).toHaveBeenCalledWith('c1')
    const selected = cy.getElementById.mock.results[0].value
    expect(selected.neighborhood).toHaveBeenCalled()
    expect(selected.add).toHaveBeenCalledWith(selected)
    expect(collection.difference).toHaveBeenCalledWith(selected.neighborhood())
    expect(collection.difference.mock.results[0].value.style).toHaveBeenCalledWith({ opacity: 0.2 })
  })

  it('highlight with null clears the dimming', async () => {
    await mountRenderer()
    const collection = cy.elements()

    renderer.highlight(null)

    expect(collection.removeStyle).toHaveBeenCalled()
    expect(collection.difference).not.toHaveBeenCalled()
  })

  it('highlight on an unknown node id is a no-op', async () => {
    await mountRenderer()
    setFoundNode('c1')
    const collection = cy.elements()

    renderer.highlight('missing')

    expect(collection.removeStyle).toHaveBeenCalled()
    expect(collection.difference).not.toHaveBeenCalled()
  })

  it('setGraph re-applies the active highlight', async () => {
    await mountRenderer()
    setFoundNode('c1')
    const collection = cy.elements()

    renderer.highlight('c1')
    const dimCallsBefore = collection.difference.mock.calls.length

    renderer.setGraph(NODES, EDGES)

    expect(collection.difference.mock.calls.length).toBeGreaterThan(dimCallsBefore)
  })

  it('onNodeClick notifies the registered callback with the tapped node', async () => {
    await mountRenderer()
    const onNodeClick = vi.fn()
    renderer.onNodeClick(onNodeClick)

    expect(mock.state.tapHandler).toBeTruthy()
    mock.state.tapHandler!({
      target: {
        data: () => ({ id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' }),
      },
    })

    expect(onNodeClick).toHaveBeenCalledWith({ id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' })
  })

  it('destroy tears the cytoscape instance down', async () => {
    await mountRenderer()

    renderer.destroy()

    expect(cy.destroy).toHaveBeenCalled()
    // double destroy is safe
    renderer.destroy()
  })
})
