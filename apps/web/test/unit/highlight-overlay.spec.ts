import type { GraphEdge, GraphNode } from '../../app/lib/graph-renderer/types'
import { describe, expect, it } from 'vitest'
import {
  applyHighlightColors,
  computeHighlightColors,
  HighlightOverlay,
} from '../../app/lib/graph-renderer/highlight-overlay'
import { buildGraphologyGraph } from '../../app/lib/graph-renderer/sigma-graph'

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

describe('computeHighlightColors', () => {
  it('returns base colors for every node when there is no highlight', () => {
    const { nodeColors, edgeColors } = computeHighlightColors(NODES, EDGES, null)

    expect(nodeColors.get('t1')).toBe('#7c3aed')
    expect(nodeColors.get('c1')).toBe('#4f46e5')
    expect(nodeColors.get('n1')).toBe('#059669')
    expect(nodeColors.get('g1')).toBe('#d97706')
    expect(edgeColors.size).toBe(3)
    for (const color of edgeColors.values())
      expect(color).toBe('#94a3b8')
  })

  it('keeps base colors for an unknown highlighted id', () => {
    const { nodeColors, edgeColors } = computeHighlightColors(NODES, EDGES, 'missing')

    expect(nodeColors.get('g1')).toBe('#d97706')
    expect(edgeColors.size).toBe(3)
    for (const color of edgeColors.values())
      expect(color).toBe('#94a3b8')
  })

  it('highlights the selected node and its 1-hop neighbors, dimming others', () => {
    const { nodeColors, edgeColors } = computeHighlightColors(NODES, EDGES, 'c1')

    expect(nodeColors.get('c1')).toBe('#4f46e5')
    expect(nodeColors.get('t1')).toBe('#7c3aed')
    expect(nodeColors.get('n1')).toBe('#059669')
    expect(nodeColors.get('g1')).toBe(rgba('#d97706', 0.2))

    const incident: string[] = []
    const nonIncident: string[] = []
    for (const [key, color] of edgeColors) {
      if (key.includes('c1'))
        incident.push(color)
      else
        nonIncident.push(color)
    }
    expect(incident).toHaveLength(2)
    expect(nonIncident).toHaveLength(1)
    expect(incident.every(c => c === '#94a3b8')).toBe(true)
    expect(nonIncident[0]).toBe(rgba('#94a3b8', 0.2))
  })

  it('ignores duplicate undirected edges, using the first occurrence', () => {
    const edges: GraphEdge[] = [
      { source: 't1', target: 'c1', type: 'GROUPED_UNDER' },
      { source: 'c1', target: 't1', type: 'RELATES_TO' },
      { source: 'c1', target: 'n1', type: 'MENTIONS' },
    ]
    const { edgeColors } = computeHighlightColors(NODES, edges, 'c1')

    // t1-c1 appears twice but only one key is emitted; the edge is incident to c1.
    expect(edgeColors.size).toBe(2)
    expect([...edgeColors.values()].every(c => c === '#94a3b8')).toBe(true)
  })
})

describe('highlightOverlay', () => {
  it('applies the current highlight state to a graphology graph', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    const overlay = new HighlightOverlay()

    overlay.setPayload(NODES, EDGES)
    overlay.highlight('c1')
    overlay.applyToGraph(graph)

    expect(graph.getNodeAttribute('c1', 'color')).toBe('#4f46e5')
    expect(graph.getNodeAttribute('g1', 'color')).toBe(rgba('#d97706', 0.2))
  })
})

describe('applyHighlightColors', () => {
  it('does not remove numeric positions when mutating colors', () => {
    const graph = buildGraphologyGraph(NODES, EDGES)
    const { nodeColors, edgeColors } = computeHighlightColors(NODES, EDGES, 'c1')

    applyHighlightColors(graph, nodeColors, edgeColors)

    graph.forEachNode((_node, attrs) => {
      expect(typeof attrs.x).toBe('number')
      expect(typeof attrs.y).toBe('number')
      expect(Number.isFinite(attrs.x)).toBe(true)
      expect(Number.isFinite(attrs.y)).toBe(true)
    })
  })
})
