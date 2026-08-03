import type { GraphEdge, GraphNode } from '../../app/lib/graph-renderer/types'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { describe, expect, it } from 'vitest'
import { applyHighlightToGraph, buildGraphologyGraph, computeCameraFit } from '../../app/lib/graph-renderer/sigma-graph'

// Regression tests against the REAL graphology + layout libraries.
// The existing sigma renderer spec mocks sigma and the layout libs; these
// tests verify the actual graph construction and highlight logic so the
// "nodes must have numeric x/y before sigma sees them" invariant cannot be
// hidden by mocks.

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

function rgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function expectNumericPositions(graph: Graph): void {
  graph.forEachNode((node, attrs) => {
    expect(typeof attrs.x, `node ${node} x is numeric`).toBe('number')
    expect(typeof attrs.y, `node ${node} y is numeric`).toBe('number')
    expect(Number.isFinite(attrs.x), `node ${node} x is finite`).toBe(true)
    expect(Number.isFinite(attrs.y), `node ${node} y is finite`).toBe(true)
  })
}

describe('buildGraphologyGraph', () => {
  it('seeds numeric x/y on every node at add time, before any layout runs', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    expect(graph.order).toBe(4)
    expect(graph.size).toBe(3)
    expectNumericPositions(graph)
  })

  it('preserves per-type colors and sizes', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    expect(graph.getNodeAttributes('t1')).toMatchObject({ color: '#7c3aed', size: 12 })
    expect(graph.getNodeAttributes('c1')).toMatchObject({ color: '#4f46e5', size: 8 })
    expect(graph.getNodeAttributes('n1')).toMatchObject({ color: '#059669', size: 6 })
    expect(graph.getNodeAttributes('g1')).toMatchObject({ color: '#d97706', size: 5 })
  })

  it('adds edges with muted base color and size', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    graph.forEachEdge((edge, attrs) => {
      expect(attrs.color).toBe('#94a3b8')
      expect(attrs.size).toBe(1.5)
    })
  })

  it('keeps numeric positions after real circular + ForceAtlas2 layout', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    circular.assign(graph, { scale: 1 })
    forceAtlas2.assign(graph, {
      iterations: 20,
      settings: forceAtlas2.inferSettings(graph),
    })
    expectNumericPositions(graph)
  })

  it('does not throw when laying out an empty graph', () => {
    const graph = buildGraphologyGraph([], [])
    expect(() => circular.assign(graph, { scale: 1 })).not.toThrow()
    expect(() => forceAtlas2.assign(graph, { iterations: 20, settings: forceAtlas2.inferSettings(graph) })).not.toThrow()
    expectNumericPositions(graph)
  })

  it('is a full replace: rebuilding drops stale nodes and edges', () => {
    const first = buildGraphologyGraph(NODES, EDGES)
    expect(first.hasNode('t1')).toBe(true)

    const second = buildGraphologyGraph([{ id: 'x1', label: 'Concept', name: 'X', ref: 'x1' }], [])
    expect(second.hasNode('t1')).toBe(false)
    expect(second.hasNode('x1')).toBe(true)
    expect(second.order).toBe(1)
    expect(second.size).toBe(0)
    expectNumericPositions(second)
  })

  it('skips edges that reference missing nodes', () => {
    const graph = buildGraphologyGraph([{ id: 't1', label: 'Topic', name: 'T', ref: 't1' }], [
      { source: 't1', target: 'missing', type: 'MENTIONS' },
    ])
    expect(graph.order).toBe(1)
    expect(graph.size).toBe(0)
  })
})

describe('applyHighlightToGraph', () => {
  it('does not throw on an empty graph', () => {
    const graph = new Graph({ type: 'undirected' })
    expect(() => applyHighlightToGraph(graph, 'nope')).not.toThrow()
    expect(() => applyHighlightToGraph(graph, null)).not.toThrow()
  })

  it('restores full colors when highlight is cleared', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(graph, 'c1')
    applyHighlightToGraph(graph, null)
    expect(graph.getNodeAttribute('g1', 'color')).toBe('#d97706')
    graph.forEachEdge((edge, attrs) => expect(attrs.color).toBe('#94a3b8'))
  })

  it('highlights the selected node and its 1-hop neighbors, dimming others', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(graph, 'c1')

    expect(graph.getNodeAttribute('c1', 'color')).toBe('#4f46e5')
    expect(graph.getNodeAttribute('t1', 'color')).toBe('#7c3aed')
    expect(graph.getNodeAttribute('n1', 'color')).toBe('#059669')
    expect(graph.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))

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
  })

  it('is a no-op for an unknown node id', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(graph, 'missing')
    expect(graph.getNodeAttribute('g1', 'color')).toBe('#d97706')
    graph.forEachEdge((edge, attrs) => expect(attrs.color).toBe('#94a3b8'))
  })

  it('does not remove numeric positions when mutating colors', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    circular.assign(graph, { scale: 1 })
    forceAtlas2.assign(graph, {
      iterations: 20,
      settings: forceAtlas2.inferSettings(graph),
    })
    applyHighlightToGraph(graph, 'c1')
    expectNumericPositions(graph)
  })

  it('keeps numeric positions through interleaved rebuild + highlight', () => {
    const a = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(a, 'c1')
    expectNumericPositions(a)

    const b = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(b, 't1')
    expectNumericPositions(b)

    // Simulate a second setGraph while a highlight is still active: rebuild
    // from scratch and re-apply the same highlight.
    const c = buildGraphologyGraph(NODES, EDGES)
    applyHighlightToGraph(c, 'c1')
    expectNumericPositions(c)
    expect(c.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))
  })
})

describe('computeCameraFit', () => {
  it('returns null for an empty graph', () => {
    const graph = new Graph({ type: 'undirected' })
    expect(computeCameraFit(graph, 833, 809)).toBeNull()
  })

  it('centers the camera on the bounding box midpoint', () => {
    const graph = buildGraphologyGraph([
      { id: 'a', label: 'Topic', name: 'A', ref: 'a' },
      { id: 'b', label: 'Topic', name: 'B', ref: 'b' },
    ], [])
    graph.setNodeAttribute('a', 'x', 0)
    graph.setNodeAttribute('a', 'y', 0)
    graph.setNodeAttribute('b', 'x', 100)
    graph.setNodeAttribute('b', 'y', 200)

    const fit = computeCameraFit(graph, 100, 100)
    expect(fit).toEqual({ x: 50, y: 100, ratio: expect.any(Number) })
  })

  it('chooses a ratio that fits the wider axis on a non-square container', () => {
    const graph = buildGraphologyGraph([
      { id: 'a', label: 'Topic', name: 'A', ref: 'a' },
      { id: 'b', label: 'Topic', name: 'B', ref: 'b' },
    ], [])
    graph.setNodeAttribute('a', 'x', 0)
    graph.setNodeAttribute('a', 'y', 0)
    graph.setNodeAttribute('b', 'x', 100)
    graph.setNodeAttribute('b', 'y', 50)

    // Container is 200x100, so height is the limiting dimension (minSide=100).
    // Bbox is 100x50. With 10% padding, padded = 100/0.8=125, 50/0.8=62.5.
    // ratio = max(125*100/200, 62.5*100/100) = max(62.5, 62.5) = 62.5.
    const fit = computeCameraFit(graph, 200, 100)
    expect(fit).toEqual({ x: 50, y: 25, ratio: 62.5 })
  })

  it('falls back to ratio 1 for a zero-size bounding box', () => {
    const graph = buildGraphologyGraph([{ id: 'a', label: 'Topic', name: 'A', ref: 'a' }], [])
    graph.setNodeAttribute('a', 'x', 42)
    graph.setNodeAttribute('a', 'y', -7)

    const fit = computeCameraFit(graph, 833, 809)
    expect(fit).toEqual({ x: 42, y: -7, ratio: 1 })
  })

  it('zooms in when the graph is smaller than the viewport', () => {
    const graph = buildGraphologyGraph([
      { id: 'a', label: 'Topic', name: 'A', ref: 'a' },
      { id: 'b', label: 'Topic', name: 'B', ref: 'b' },
    ], [])
    graph.setNodeAttribute('a', 'x', 0)
    graph.setNodeAttribute('a', 'y', 0)
    graph.setNodeAttribute('b', 'x', 1)
    graph.setNodeAttribute('b', 'y', 1)

    const fit = computeCameraFit(graph, 100, 100)
    // Padded 1x1 → 1.25. ratio = 1.25 * 100 / 100 = 1.25.
    expect(fit!.ratio).toBe(1.25)
    expect(fit!.x).toBe(0.5)
    expect(fit!.y).toBe(0.5)
  })

  it('produces a sane fit after a real circular + ForceAtlas2 layout', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    circular.assign(graph, { scale: 1 })
    forceAtlas2.assign(graph, {
      iterations: 20,
      settings: forceAtlas2.inferSettings(graph),
    })

    const fit = computeCameraFit(graph, 833, 809)
    expect(fit).not.toBeNull()
    expect(Number.isFinite(fit!.x)).toBe(true)
    expect(Number.isFinite(fit!.y)).toBe(true)
    expect(fit!.ratio).toBeGreaterThan(0)
    expect(Number.isFinite(fit!.ratio)).toBe(true)
  })
})
