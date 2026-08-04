import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ConceptDetail from '../../app/components/graph/concept-detail.vue'

const baseDetail = {
  concept: { id: 'c1', name: 'Graph RAG', description: null, topics: [] },
  neighbors: [],
  mentionedIn: [],
}

describe('graph-concept-detail', () => {
  it('appends a gray <rootName> suffix to mentioned notes that carry a rootName', async () => {
    const component = await mountSuspended(ConceptDetail, {
      props: {
        detail: {
          ...baseDetail,
          mentionedIn: [
            { path: '/justjom/plans/a.md', title: 'Plan A', rootName: 'justjom' },
          ],
        },
      },
    })

    const button = component.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Plan A')

    const suffix = button.find('span.text-gray-400')
    expect(suffix.exists()).toBe(true)
    expect(suffix.text()).toContain('<justjom>')
  })

  it('does not render a suffix for mentioned notes without a rootName', async () => {
    const component = await mountSuspended(ConceptDetail, {
      props: {
        detail: {
          ...baseDetail,
          mentionedIn: [
            { path: '/notes/plain.md', title: 'Plain' },
          ],
        },
      },
    })

    const button = component.find('button')
    expect(button.text()).toContain('Plain')
    expect(button.find('span.text-gray-400').exists()).toBe(false)
  })

  it('falls back to the note path when title is empty', async () => {
    const component = await mountSuspended(ConceptDetail, {
      props: {
        detail: {
          ...baseDetail,
          mentionedIn: [
            { path: '/notes/named.md', title: '' },
          ],
        },
      },
    })

    const button = component.find('button')
    expect(button.text()).toContain('/notes/named.md')
  })

  it('emits openNote with the note path and syncedFolderId when a mentioned note is clicked', async () => {
    const component = await mountSuspended(ConceptDetail, {
      props: {
        detail: {
          ...baseDetail,
          mentionedIn: [
            { path: '/justjom/plans/a.md', title: 'Plan A', rootName: 'justjom', syncedFolderId: 'sf-1' },
          ],
        },
      },
    })

    await component.find('button').trigger('click')
    expect(component.emitted('openNote')).toEqual([['/justjom/plans/a.md', 'sf-1']])
  })

  it('omits syncedFolderId from the openNote emit when the note has none', async () => {
    const component = await mountSuspended(ConceptDetail, {
      props: {
        detail: {
          ...baseDetail,
          mentionedIn: [
            { path: '/notes/plain.md', title: 'Plain' },
          ],
        },
      },
    })

    await component.find('button').trigger('click')
    expect(component.emitted('openNote')).toEqual([['/notes/plain.md', undefined]])
  })
})
