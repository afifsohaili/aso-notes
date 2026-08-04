import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GraphCanvas from '../../app/components/graph/graph-canvas.vue'

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
})
