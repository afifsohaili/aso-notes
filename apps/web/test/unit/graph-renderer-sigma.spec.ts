import type { GraphEdge, GraphNode, GraphRenderer } from '../../app/lib/graph-renderer/types'
import Graph from 'graphology'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGraphRenderer, GRAPH_RENDERER_IMPLS } from '../../app/lib/graph-renderer'

// --- Mock sigma + the layout libs at the system boundary ------------------
// The renderer dynamically imports sigma inside mount() and statically
// imports the (pure-JS) graphology-layout packages. Replacing sigma and the
// layout libs here lets us observe the renderer's contract through the real
// graphology graph it builds, without a browser / WebGL context.
//
// NOTE: sigma v3 removed the v2 reducer API entirely, so the renderer dims
// via graph-attribute mutation + refresh(); we assert on those attributes.

const mock = vi.hoisted(() => {
  const state: {
    lastSigma: any
    lastGraph: any
    sigmaSettings: any
    handlers: Record<string, (payload: any) => void>
    sigmaCtorCalls: number
    circularAssign: any
    fa2Assign: any
    fa2InferSettings: any
    cameraSetState: any
  } = {
    lastSigma: null,
    lastGraph: null,
    sigmaSettings: null,
    handlers: {},
    sigmaCtorCalls: 0,
    circularAssign: null,
    fa2Assign: null,
    fa2InferSettings: null,
    cameraSetState: null,
  }

  state.circularAssign = vi.fn()
  state.fa2Assign = vi.fn()
  state.fa2InferSettings = vi.fn(() => ({ gravity: 1 }))
  state.cameraSetState = vi.fn()

  return { state }
})

vi.mock('sigma', () => ({
  default: class MockSigma {
    camera: any

    constructor(graph: any, container: any, settings: any) {
      mock.state.lastSigma = this
      mock.state.lastGraph = graph
      mock.state.sigmaSettings = settings
      mock.state.sigmaCtorCalls += 1
      this.camera = {
        setState: mock.state.cameraSetState,
      }
    }

    on = vi.fn((event: string, handler: (payload: any) => void) => {
      mock.state.handlers[event] = handler
    })

    getCamera = vi.fn(function (this: any) {
      return this.camera
    })

    refresh = vi.fn()
    kill = vi.fn()
  },
}))

vi.mock('graphology-layout', () => {
  const circular: any = vi.fn()
  circular.assign = mock.state.circularAssign
  return { circular }
})

vi.mock('graphology-layout-forceatlas2', () => {
  const forceAtlas2: any = vi.fn()
  forceAtlas2.assign = mock.state.fa2Assign
  forceAtlas2.inferSettings = mock.state.fa2InferSettings
  return { default: forceAtlas2 }
})

// --- Fixtures -------------------------------------------------------------

const NODES: GraphNode[] = [
  { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
  { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
  { id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' },
  { id: 'g1', label: 'Tag', name: 'Tag A', ref: 'g1' },
]

const EDGES: GraphEdge[] = [
  { source: 't1', target: 'c1', type: 'GROUPED_UNDER' },
  { source: 'c1', target: 'n1', type: 'MENTIONS' },
  { source: 'n1', target: 'g1', type: 'TAGGED' },
]

// Dimmed color helper — mirrors the renderer's rgba conversion.
function rgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

describe('createGraphRenderer — sigma impl', () => {
  beforeEach(() => {
    mock.state.lastSigma = null
    mock.state.lastGraph = null
    mock.state.sigmaSettings = null
    mock.state.handlers = {}
    mock.state.sigmaCtorCalls = 0
    mock.state.circularAssign.mockClear()
    mock.state.fa2Assign.mockClear()
    mock.state.fa2InferSettings.mockClear()
    mock.state.cameraSetState.mockClear()
  })

  it('registers sigma in the impl registry', () => {
    expect(GRAPH_RENDERER_IMPLS).toContain('sigma')
  })

  it('returns a renderer implementing the full GraphRenderer contract', async () => {
    const renderer = createGraphRenderer('sigma')

    expect(typeof renderer.mount).toBe('function')
    expect(typeof renderer.setGraph).toBe('function')
    expect(typeof renderer.highlight).toBe('function')
    expect(typeof renderer.onNodeClick).toBe('function')
    expect(typeof renderer.destroy).toBe('function')

    await renderer.mount({} as HTMLElement)
    expect(mock.state.sigmaCtorCalls).toBe(1)

    renderer.destroy()
    expect(mock.state.lastSigma.kill).toHaveBeenCalled()
  })
})

describe('sigma renderer contract', () => {
  let renderer: GraphRenderer
  let sigma: any
  let graph: Graph

  beforeEach(() => {
    mock.state.lastSigma = null
    mock.state.lastGraph = null
    mock.state.sigmaSettings = null
    mock.state.handlers = {}
    mock.state.sigmaCtorCalls = 0
    mock.state.circularAssign.mockClear()
    mock.state.fa2Assign.mockClear()
    mock.state.fa2InferSettings.mockClear()
    mock.state.cameraSetState.mockClear()
    renderer = createGraphRenderer('sigma')
  })

  async function mountRenderer() {
    const container = {
      getBoundingClientRect: () => ({ width: 833, height: 809 }),
    } as HTMLElement
    await renderer.mount(container)
    sigma = mock.state.lastSigma
    graph = mock.state.lastGraph
    expect(sigma).toBeTruthy()
    expect(graph).toBeInstanceOf(Graph)
  }

  it('mount builds a sigma instance on the container with label threshold settings', async () => {
    await mountRenderer()

    expect(mock.state.sigmaCtorCalls).toBe(1)
    expect(mock.state.sigmaSettings).toMatchObject({ labelRenderedSizeThreshold: 8 })
    expect(sigma.on).toHaveBeenCalledWith('clickNode', expect.any(Function))
    expect(sigma.refresh).toHaveBeenCalled()

    // double mount is a no-op — no second sigma instance
    await renderer.mount({} as HTMLElement)
    expect(mock.state.sigmaCtorCalls).toBe(1)
  })

  it('setGraph adds nodes with per-type color/size and nodeData, edges with muted color', async () => {
    await mountRenderer()

    renderer.setGraph(NODES, EDGES)

    expect(graph.order).toBe(4)
    expect(graph.size).toBe(3)

    expect(graph.getNodeAttributes('t1')).toMatchObject({
      label: 'Topic A',
      color: '#7c3aed',
      size: 12,
      nodeData: { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
    })
    expect(graph.getNodeAttributes('c1')).toMatchObject({
      label: 'Concept A',
      color: '#4f46e5',
      size: 8,
      nodeData: { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
    })
    expect(graph.getNodeAttributes('n1')).toMatchObject({ color: '#059669', size: 6 })
    expect(graph.getNodeAttributes('g1')).toMatchObject({ color: '#d97706', size: 5 })

    const edge = graph.getEdgeAttributes(graph.edges()[0])
    expect(edge).toMatchObject({ color: '#94a3b8', size: 1.5, edgeType: 'GROUPED_UNDER' })
  })

  it('setGraph runs circular seed then bounded FA2 assign, then refreshes sigma', async () => {
    await mountRenderer()

    renderer.setGraph(NODES, EDGES)

    expect(mock.state.circularAssign).toHaveBeenCalledWith(graph, expect.anything())
    expect(mock.state.fa2InferSettings).toHaveBeenCalledWith(graph)
    expect(mock.state.fa2Assign).toHaveBeenCalledWith(graph, expect.anything())
    const fa2Params = mock.state.fa2Assign.mock.calls[0][1]
    expect(fa2Params.iterations).toBeGreaterThanOrEqual(100)
    expect(fa2Params.iterations).toBeLessThanOrEqual(200)

    // circular seeds before FA2 settles positions
    const circularOrder = mock.state.circularAssign.mock.invocationCallOrder[0]
    const fa2Order = mock.state.fa2Assign.mock.invocationCallOrder[0]
    expect(circularOrder).toBeLessThan(fa2Order)

    expect(sigma.refresh).toHaveBeenCalled()
  })

  it('setGraph is a full replace — old elements are dropped', async () => {
    await mountRenderer()

    renderer.setGraph(NODES, EDGES)
    renderer.setGraph([{ id: 'x1', label: 'Concept', name: 'X', ref: 'x1' }], [])

    expect(graph.order).toBe(1)
    expect(graph.size).toBe(0)
    expect(graph.hasNode('t1')).toBe(false)
    expect(graph.hasNode('x1')).toBe(true)
  })

  it('setGraph seeds numeric x/y on every node before sigma can refresh', async () => {
    await mountRenderer()

    renderer.setGraph(NODES, EDGES)

    graph.forEachNode((node, attrs) => {
      expect(typeof attrs.x, `node ${node} x is numeric`).toBe('number')
      expect(typeof attrs.y, `node ${node} y is numeric`).toBe('number')
      expect(Number.isFinite(attrs.x)).toBe(true)
      expect(Number.isFinite(attrs.y)).toBe(true)
    })
  })

  it('highlight before setGraph does not crash the renderer', async () => {
    await mountRenderer()

    expect(() => renderer.highlight('c1')).not.toThrow()
    expect(() => renderer.highlight(null)).not.toThrow()
  })

  it('setGraph fits the camera to the graph bounding box with padding', async () => {
    await mountRenderer()

    renderer.setGraph(NODES, EDGES)

    expect(sigma.getCamera).toHaveBeenCalled()
    expect(mock.state.cameraSetState).toHaveBeenCalledWith({ x: 0, y: 0, ratio: 2.5 })
  })

  it('setGraph called before mount is applied once mount completes', async () => {
    renderer.setGraph(NODES, EDGES)

    await mountRenderer()

    expect(graph.order).toBe(4)
    expect(graph.size).toBe(3)
    expect(sigma.getCamera).toHaveBeenCalled()
    expect(mock.state.cameraSetState).toHaveBeenCalled()
    expect(sigma.refresh).toHaveBeenCalled()
  })

  it('setGraph before mount keeps the latest data', async () => {
    renderer.setGraph([{ id: 'old', label: 'Topic', name: 'Old', ref: 'old' }], [])
    renderer.setGraph(NODES, EDGES)

    await mountRenderer()

    expect(graph.hasNode('old')).toBe(false)
    expect(graph.hasNode('t1')).toBe(true)
  })

  it('highlight before mount is applied after setGraph resolves', async () => {
    renderer.setGraph(NODES, EDGES)
    renderer.highlight('c1')

    await mountRenderer()

    // Active highlight should have been re-applied after the delayed setGraph.
    expect(graph.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))
  })

  it('highlight dims non-neighbor nodes and non-incident edges to 0.2 alpha', async () => {
    await mountRenderer()
    renderer.setGraph(NODES, EDGES)

    renderer.highlight('c1')

    // c1 and its 1-hop neighbors (t1, n1) keep full color
    expect(graph.getNodeAttribute('c1', 'color')).toBe('#4f46e5')
    expect(graph.getNodeAttribute('t1', 'color')).toBe('#7c3aed')
    expect(graph.getNodeAttribute('n1', 'color')).toBe('#059669')
    // g1 is not a neighbor → dimmed
    expect(graph.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))

    // edges incident to c1 keep color; n1-g1 dimmed
    let incident = 0
    let nonIncident = 0
    graph.forEachEdge((edge, attrs, source, target) => {
      if (source === 'c1' || target === 'c1') {
        incident += 1
        expect(attrs.color).toBe('#94a3b8')
      }
      else {
        nonIncident += 1
        expect(attrs.color).toBe(rgba('#94a3b8', 0.2))
      }
    })
    expect(incident).toBe(2)
    expect(nonIncident).toBe(1)

    expect(sigma.refresh).toHaveBeenCalled()
  })

  it('highlight with null restores full colors', async () => {
    await mountRenderer()
    renderer.setGraph(NODES, EDGES)

    renderer.highlight('c1')
    renderer.highlight(null)

    expect(graph.getNodeAttribute('g1', 'color')).toBe('#d97706')
    graph.forEachEdge((edge, attrs) => expect(attrs.color).toBe('#94a3b8'))
  })

  it('highlight on an unknown node id is a no-op', async () => {
    await mountRenderer()
    renderer.setGraph(NODES, EDGES)

    renderer.highlight('missing')

    expect(graph.getNodeAttribute('g1', 'color')).toBe('#d97706')
    graph.forEachEdge((edge, attrs) => expect(attrs.color).toBe('#94a3b8'))
  })

  it('setGraph re-applies the active highlight', async () => {
    await mountRenderer()
    renderer.setGraph(NODES, EDGES)

    renderer.highlight('c1')
    renderer.setGraph(NODES, EDGES)

    // fresh nodes get full colors, then the active highlight dims g1 again
    expect(graph.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))
  })

  it('onNodeClick notifies the registered callback with the stored GraphNode', async () => {
    await mountRenderer()
    renderer.setGraph(NODES, EDGES)
    const onNodeClick = vi.fn()
    renderer.onNodeClick(onNodeClick)

    expect(mock.state.handlers.clickNode).toBeTruthy()
    mock.state.handlers.clickNode!({ event: {}, node: 'c1' })

    expect(onNodeClick).toHaveBeenCalledWith({ id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' })
  })

  it('destroy kills the sigma instance and double-destroy is safe', async () => {
    await mountRenderer()

    renderer.destroy()

    expect(sigma.kill).toHaveBeenCalled()
    renderer.destroy()
  })
})
