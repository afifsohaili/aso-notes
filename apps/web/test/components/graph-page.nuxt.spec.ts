import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ConceptDetail from '../../app/components/graph/concept-detail.vue'
import GraphCanvas from '../../app/components/graph/graph-canvas.vue'
import GraphIndexPage from '../../app/pages/graph/index.vue'

const { useFetchMock, navigateToMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  navigateToMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('navigateTo', () => navigateToMock)

function mockFetch(graph: unknown, concepts: unknown[] = []) {
  useFetchMock.mockImplementation((source: unknown) => {
    // Third call is the concept-detail fetch: a computed, nullable source.
    if (typeof source === 'function')
      return { data: ref(null), pending: ref(false), refresh: vi.fn() }
    const url = String(source)
    return {
      data: ref(url.includes('/graph/concepts') ? concepts : graph),
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

const noteNode = {
  id: 'n1',
  label: 'Note',
  name: 'Plan',
  ref: '/project-a/plan.md',
  rootName: 'plans',
  syncedFolderId: 'sf-1',
}

beforeEach(() => {
  navigateToMock.mockClear()
  useFetchMock.mockClear()
})

describe('graph index page', () => {
  it('navigates to a note with the syncedFolder query when the node has one', async () => {
    mockFetch({ nodes: [noteNode], edges: [] })

    const component = await mountSuspended(GraphIndexPage, {
      global: {
        stubs: {
          ClientOnly: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    canvas.vm.$emit('selectNode', noteNode)
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/project-a/plan.md?syncedFolder=sf-1')
  })

  it('navigates to a note without a syncedFolder query when the node lacks one', async () => {
    mockFetch({
      nodes: [{ ...noteNode, ref: 'relative.md', syncedFolderId: undefined }],
      edges: [],
    })

    const component = await mountSuspended(GraphIndexPage, {
      global: {
        stubs: {
          ClientOnly: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    canvas.vm.$emit('selectNode', { ...noteNode, ref: 'relative.md', syncedFolderId: undefined })
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/relative.md')
  })

  it('navigates to a mentioned note with the syncedFolder query when the note has one', async () => {
    mockFetch({ nodes: [noteNode], edges: [] })

    const component = await mountSuspended(GraphIndexPage, {
      global: {
        stubs: {
          ClientOnly: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    const detail = component.findComponent(ConceptDetail)
    detail.vm.$emit('openNote', '/justjom/plans/a.md', 'sf-1')
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/justjom/plans/a.md?syncedFolder=sf-1')
  })

  it('navigates to a mentioned note without a syncedFolder query when the note lacks one', async () => {
    mockFetch({ nodes: [noteNode], edges: [] })

    const component = await mountSuspended(GraphIndexPage, {
      global: {
        stubs: {
          ClientOnly: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    const detail = component.findComponent(ConceptDetail)
    detail.vm.$emit('openNote', '/notes/plain.md')
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/notes/plain.md')
  })

  it('selects a concept and keeps navigateTo untouched', async () => {
    mockFetch({ nodes: [noteNode], edges: [] })

    const component = await mountSuspended(GraphIndexPage, {
      global: {
        stubs: {
          ClientOnly: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    canvas.vm.$emit('selectNode', { id: 'c1', label: 'Concept', name: 'Graph RAG', ref: 'c1' })
    await flushPromises()

    expect(navigateToMock).not.toHaveBeenCalled()

    // The concept-detail fetch source resolves to the selected concept's URL.
    const detailSource = useFetchMock.mock.calls
      .map(([source]) => source)
      .find((source: unknown) => typeof source === 'function') as () => string | null
    expect(detailSource()).toBe('/api/graph/concepts/c1')
  })
})
