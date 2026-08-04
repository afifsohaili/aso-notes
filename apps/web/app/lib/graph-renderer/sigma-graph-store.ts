import type { GraphEdge, GraphNode } from './types'
import Graph from 'graphology'
import { applyHighlightToGraph, buildGraphologyGraph, runLayout } from './sigma-graph'

/**
 * Adapter between the renderer and the graphology graph. sigma v3 allows
 * rebinding the graph via `sigma.setGraph()`, so this store builds a fresh
 * graphology graph on every replace and keeps the current instance available
 * for the surface.
 */
export class SigmaGraphStore {
  private _graph: Graph
  private highlightedNodeId: string | null = null

  constructor() {
    this._graph = new Graph({ type: 'undirected' })
  }

  get graph(): Graph {
    return this._graph
  }

  /**
   * Build a fresh graphology graph from the given nodes and edges, run the
   * layout, and return the new graph instance. The previous graph is discarded
   * (sigma will be rebound by the renderer).
   */
  replace(nodes: GraphNode[], edges: GraphEdge[]): Graph {
    this._graph = buildGraphologyGraph(nodes, edges)
    runLayout(this._graph)
    this.applyHighlight()
    return this._graph
  }

  /**
   * Set the highlighted node id and apply the effective colors to the current
   * graph. Passing `null` clears the highlight.
   */
  applyHighlight(nodeId: string | null = this.highlightedNodeId): void {
    this.highlightedNodeId = nodeId
    applyHighlightToGraph(this._graph, this.highlightedNodeId)
  }

  /**
   * Retrieve the original GraphNode payload stored in a graphology node. Used
   * by the click handler to report which node was tapped.
   */
  getNodeData(nodeId: string): GraphNode | undefined {
    return this._graph.getNodeAttribute(nodeId, 'nodeData') as GraphNode | undefined
  }
}
