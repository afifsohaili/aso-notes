import type { GraphEdge, GraphNode } from '../../app/lib/graph-renderer/types'
import { describe, expect, it } from 'vitest'
import { mergeGraphEdges, mergeGraphNodes } from '../../app/lib/graph-renderer/merge'

describe('mergeGraphNodes', () => {
  it('appends new nodes to the current set', () => {
    const current: GraphNode[] = [
      { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
    ]
    const incoming: GraphNode[] = [
      { id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' },
    ]
    expect(mergeGraphNodes(current, incoming)).toEqual([
      { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
      { id: 'n1', label: 'Note', name: 'Note A', ref: '/notes/a.md' },
    ])
  })

  it('dedupes by node id, keeping the existing node', () => {
    const current: GraphNode[] = [
      { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
    ]
    const incoming: GraphNode[] = [
      { id: 'c1', label: 'Concept', name: 'Renamed', ref: 'c1' },
      { id: 't2', label: 'Topic', name: 'Topic B', ref: 't2' },
    ]
    const merged = mergeGraphNodes(current, incoming)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual({ id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' })
    expect(merged[1]).toEqual({ id: 't2', label: 'Topic', name: 'Topic B', ref: 't2' })
  })

  it('does not mutate its inputs', () => {
    const current: GraphNode[] = [{ id: 'c1', label: 'Concept', name: 'A', ref: 'c1' }]
    const incoming: GraphNode[] = [{ id: 'c1', label: 'Concept', name: 'A', ref: 'c1' }]
    mergeGraphNodes(current, incoming)
    expect(current).toHaveLength(1)
    expect(incoming).toHaveLength(1)
  })
})

describe('mergeGraphEdges', () => {
  it('appends new edges and dedupes by source/target/type', () => {
    const current: GraphEdge[] = [
      { source: 'c1', target: 't1', type: 'GROUPED_UNDER' },
    ]
    const incoming: GraphEdge[] = [
      { source: 'c1', target: 't1', type: 'GROUPED_UNDER' },
      { source: 'c1', target: 'n1', type: 'MENTIONS' },
    ]
    expect(mergeGraphEdges(current, incoming)).toEqual([
      { source: 'c1', target: 't1', type: 'GROUPED_UNDER' },
      { source: 'c1', target: 'n1', type: 'MENTIONS' },
    ])
  })

  it('treats opposite directions as distinct edges', () => {
    const current: GraphEdge[] = [{ source: 'a', target: 'b', type: 'RELATES_TO', edgeType: 'references' }]
    const incoming: GraphEdge[] = [{ source: 'b', target: 'a', type: 'RELATES_TO', edgeType: 'references' }]
    expect(mergeGraphEdges(current, incoming)).toHaveLength(2)
  })

  it('distinguishes edges that differ only by relation type', () => {
    const current: GraphEdge[] = [{ source: 'a', target: 'b', type: 'RELATES_TO', edgeType: 'references' }]
    const incoming: GraphEdge[] = [{ source: 'a', target: 'b', type: 'RELATES_TO', edgeType: 'contradicts' }]
    expect(mergeGraphEdges(current, incoming)).toHaveLength(2)
  })
})
