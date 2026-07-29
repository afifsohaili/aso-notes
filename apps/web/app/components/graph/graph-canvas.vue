<script setup lang="ts">
import type { GraphEdge, GraphNode } from '~/server/lib/graph/ui'

const props = defineProps<{
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
}>()

const emit = defineEmits<{
  (e: 'selectNode', node: GraphNode): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let cy: any = null

function nodeColor(label: GraphNode['label']): string {
  switch (label) {
    case 'Concept':
      return '#4f46e5'
    case 'Topic':
      return '#7c3aed'
    case 'Note':
      return '#059669'
    case 'Tag':
      return '#d97706'
    default:
      return '#6b7280'
  }
}

function buildElements() {
  const elements: any[] = []
  for (const node of props.nodes) {
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
  for (const edge of props.edges) {
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

function applyHighlight() {
  if (!cy)
    return
  cy.elements().removeStyle()
  if (!props.selectedNodeId) {
    return
  }
  const selected = cy.getElementById(props.selectedNodeId)
  if (!selected.length)
    return
  const neighborhood = selected.neighborhood().add(selected)
  cy.elements().difference(neighborhood).style({ opacity: 0.2 })
}

async function initCytoscape() {
  try {
    if (!containerRef.value)
      return
    const cytoscape = (await import('cytoscape')).default
    const fcose = (await import('cytoscape-fcose')).default
    cytoscape.use(fcose)

    cy = cytoscape({
      container: containerRef.value,
      elements: buildElements(),
      style: [
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
      ],
      layout: {
        name: 'fcose',
        padding: 16,
        animate: false,
        fit: true,
        componentSpacing: 60,
        nodeRepulsion: 4000,
        idealEdgeLength: 80,
      },
    })

    cy.on('tap', 'node', (evt: any) => {
      const node = evt.target.data() as GraphNode
      emit('selectNode', {
        id: node.id,
        label: node.label,
        name: node.name,
        ref: node.ref,
      })
    })
  }
  catch (err) {
    console.error('Cytoscape init failed:', err)
  }
}

onMounted(() => {
  initCytoscape()
})

onUnmounted(() => {
  if (cy) {
    cy.destroy()
    cy = null
  }
})

watch(() => [props.nodes, props.edges], () => {
  if (!cy)
    return
  cy.elements().remove()
  cy.add(buildElements())
  cy.layout({ name: 'fcose', padding: 16, animate: false, fit: true }).run()
  applyHighlight()
}, { deep: true })

watch(() => props.selectedNodeId, () => {
  applyHighlight()
})
</script>

<template>
  <div ref="containerRef" class="w-full h-full bg-gray-50" />
</template>
