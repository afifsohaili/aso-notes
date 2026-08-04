import type cytoscape from 'cytoscape'
import type { GraphEdge, GraphNode, GraphRenderer } from './types'
import { NODE_COLORS } from './constants'

function nodeColor(label: GraphNode['label']): string {
  return NODE_COLORS[label] ?? '#6b7280'
}

/** Full fcose config (same tuning the original init used). */
const LAYOUT_CONFIG = {
  name: 'fcose',
  padding: 16,
  animate: false,
  fit: true,
  componentSpacing: 60,
  nodeRepulsion: 4000,
  idealEdgeLength: 80,
} as const

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'label': 'data(name)',
      'width': 32,
      'height': 32,
      'font-size': '10px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'color': '#374151',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.8,
      'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
    },
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#9ca3af',
      'target-arrow-color': '#9ca3af',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 0.8,
    },
  },
  {
    selector: ':selected',
    style: {
      'border-width': 3,
      'border-color': '#111827',
    },
  },
  {
    selector: 'node[label = "Topic"]',
    style: {
      width: 40,
      height: 40,
    },
  },
]

/**
 * Cytoscape implementation of `GraphRenderer` — the logic that previously
 * lived inside `graph-canvas.vue`, moved behind the seam unchanged.
 */
export class CytoscapeRenderer implements GraphRenderer {
  private cy: any = null
  private clickHandler: ((node: GraphNode) => void) | null = null
  private highlightedNodeId: string | null = null

  async mount(container: HTMLElement): Promise<void> {
    if (this.cy)
      return
    const cytoscape = (await import('cytoscape')).default
    const fcose = (await import('cytoscape-fcose')).default
    cytoscape.use(fcose)

    this.cy = cytoscape({
      container,
      elements: [],
      style: STYLE,
    })

    this.cy.on('tap', 'node', (evt: any) => {
      if (!this.clickHandler)
        return
      const data = evt.target.data()
      this.clickHandler({
        id: data.id,
        label: data.label,
        name: data.name,
        ref: data.ref,
      })
    })

    // The graph is empty until the page calls setGraph() (mount happens
    // first), so this initial layout only settles the instance; the real one
    // runs inside setGraph(). mount() still waits for it so callers know the
    // renderer is ready to receive data.
    await this.runLayout()
  }

  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.cy)
      return
    this.cy.elements().remove()
    this.cy.add(this.buildElements(nodes, edges))
    this.runLayout()
    this.applyHighlight()
  }

  highlight(nodeId: string | null): void {
    this.highlightedNodeId = nodeId
    this.applyHighlight()
  }

  onNodeClick(cb: (node: GraphNode) => void): void {
    this.clickHandler = cb
  }

  destroy(): void {
    if (this.cy) {
      this.cy.destroy()
      this.cy = null
    }
    this.clickHandler = null
    this.highlightedNodeId = null
  }

  private buildElements(nodes: GraphNode[], edges: GraphEdge[]): any[] {
    const elements: any[] = []
    for (const node of nodes) {
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          name: node.name,
          ref: node.ref,
          color: nodeColor(node.label),
        },
      })
    }
    for (const edge of edges) {
      elements.push({
        data: {
          id: `${edge.source}-${edge.target}-${edge.type}`,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          edgeType: edge.edgeType,
        },
      })
    }
    return elements
  }

  private applyHighlight(): void {
    if (!this.cy)
      return
    this.cy.elements().removeStyle()
    if (!this.highlightedNodeId)
      return
    const selected = this.cy.getElementById(this.highlightedNodeId)
    if (!selected.length)
      return
    const neighborhood = selected.neighborhood().add(selected)
    this.cy.elements().difference(neighborhood).style({ opacity: 0.2 })
  }

  private async runLayout(): Promise<void> {
    if (!this.cy)
      return
    const layout = this.cy.layout({ ...LAYOUT_CONFIG })
    const finished = layout.promiseOn('layoutstop')
    layout.run()
    await finished
  }
}
