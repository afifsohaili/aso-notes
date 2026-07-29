import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ConceptList from '../../app/components/graph/concept-list.vue'

describe('graph-concept-list', () => {
  it('renders concepts and emits selection', async () => {
    const component = await mountSuspended(ConceptList, {
      props: {
        concepts: [
          { id: 'c1', name: 'Graph RAG', description: 'retrieval', mentionCount: 2, topics: [] },
          { id: 'c2', name: 'Kysely', description: 'SQL builder', mentionCount: 1, topics: ['Databases'] },
        ],
        selectedConceptId: null,
      },
    })

    const html = component.html()
    expect(html).toContain('Graph RAG')
    expect(html).toContain('Kysely')
    expect(html).toContain('2')

    const items = component.findAll('li')
    expect(items).toHaveLength(2)

    await items[0]!.trigger('click')
    expect(component.emitted('select')).toHaveLength(1)
    expect(component.emitted('select')![0]).toEqual(['c2'])
  })

  it('filters concepts by search query', async () => {
    const component = await mountSuspended(ConceptList, {
      props: {
        concepts: [
          { id: 'c1', name: 'Graph RAG', description: 'retrieval', mentionCount: 2, topics: [] },
          { id: 'c2', name: 'Kysely', description: 'SQL builder', mentionCount: 1, topics: ['Databases'] },
        ],
        selectedConceptId: null,
      },
    })

    const input = component.find('input')
    await input.setValue('kys')

    const items = component.findAll('li')
    expect(items).toHaveLength(1)
    expect(items[0]!.text()).toContain('Kysely')
  })
})
