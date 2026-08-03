import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import GraphCanvas from '../../app/components/graph/graph-canvas.vue'
import GraphPage from '../../app/pages/graph/index.vue'

const { useFetchMock, navigateToMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  navigateToMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('navigateTo', () => navigateToMock)

vi.stubGlobal('$fetch', $fetchMock)

// --- Fixtures -------------------------------------------------------------

const overview = {
  nodes: [
    { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
    { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
  ],
  edges: [{ source: 'c1', target: 't1', type: 'GROUPED_UNDER' }],
}

const neighborhood = {
  nodes: [
    { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
    { id: 'n1', label: 'Note', name: 'Note A', ref: '/project-a/plan.md' },
    { id: 't2', label: 'Topic', name: 'Topic B', ref: 't2' },
  ],
  edges: [
    { source: 'c1', target: 'n1', type: 'MENTIONS' },
    { source: 'c1', target: 't2', type: 'GROUPED_UNDER' },
  ],
}

const conceptNode = { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' }
const topicNode = { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' }
const noteNode = { id: 'n1', label: 'Note', name: 'Note A', ref: '/project-a/plan.md' }

function mockUseFetch() {
  useFetchMock.mockImplementation((url: unknown) => {
    if (url === '/api/graph') {
      return {
        data: ref(overview) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
        error: ref(null),
      }
    }
    return {
      data: ref([]) as Ref<unknown>,
      pending: ref(false),
      refresh: vi.fn(),
      error: ref(null),
    }
  })
}

async function mountPage() {
  mockUseFetch()
  return await mountSuspended(GraphPage, {
    global: { stubs: { GraphCanvas: true } },
  })
}

// --- Specs ----------------------------------------------------------------

describe('graph page drill-down', () => {
  beforeEach(() => {
    useFetchMock.mockReset()
    navigateToMock.mockReset()
    $fetchMock.mockReset()
  })

  it('loads the topic overview on mount', async () => {
    await mountPage()

    expect(useFetchMock.mock.calls[0]?.[0]).toBe('/api/graph')
  })

  it('expands a Concept node: fetches its neighborhood and merges it in', async () => {
    $fetchMock.mockResolvedValue(neighborhood)
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    expect(canvas.exists()).toBe(true)
    expect(canvas.props('nodes')).toHaveLength(2)

    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/graph/neighborhood?node=c1&depth=1')
    expect(canvas.props('nodes')).toEqual([
      { id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' },
      { id: 'c1', label: 'Concept', name: 'Concept A', ref: 'c1' },
      { id: 'n1', label: 'Note', name: 'Note A', ref: '/project-a/plan.md' },
      { id: 't2', label: 'Topic', name: 'Topic B', ref: 't2' },
    ])
    expect(canvas.props('edges')).toEqual([
      { source: 'c1', target: 't1', type: 'GROUPED_UNDER' },
      { source: 'c1', target: 'n1', type: 'MENTIONS' },
      { source: 'c1', target: 't2', type: 'GROUPED_UNDER' },
    ])
  })

  it('does not refetch or merge when clicking an already-expanded node', async () => {
    $fetchMock.mockResolvedValue(neighborhood)
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()
    expect($fetchMock).toHaveBeenCalledTimes(1)

    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledTimes(1)
    expect(canvas.props('nodes')).toHaveLength(4)
  })

  it('ignores clicks while a neighborhood fetch is in flight for that node', async () => {
    let resolveFetch!: (value: unknown) => void
    $fetchMock.mockReturnValueOnce(
      new Promise((resolve) => { resolveFetch = resolve }),
    )
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    await canvas.vm.$emit('selectNode', conceptNode)
    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(neighborhood)
    await flushPromises()
  })

  it('keeps navigating to notes when a Note node is clicked', async () => {
    $fetchMock.mockResolvedValue(neighborhood)
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    await canvas.vm.$emit('selectNode', noteNode)
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/project-a/plan.md')
    expect($fetchMock).not.toHaveBeenCalled()
  })

  it('expands a Topic node too', async () => {
    $fetchMock.mockResolvedValue({ nodes: [{ id: 't1', label: 'Topic', name: 'Topic A', ref: 't1' }], edges: [] })
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    await canvas.vm.$emit('selectNode', topicNode)
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/graph/neighborhood?node=t1&depth=1')
  })

  it('surfaces a dismissible error when the neighborhood fetch fails', async () => {
    $fetchMock.mockRejectedValue(new Error('boom'))
    const component = await mountPage()
    await flushPromises()

    const canvas = component.findComponent(GraphCanvas)
    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()

    const errorNote = component.find('[data-testid="graph-error"]')
    expect(errorNote.exists()).toBe(true)
    expect(errorNote.text()).toContain('boom')

    // A failed expansion is not marked expanded, so a later click retries.
    await canvas.vm.$emit('selectNode', conceptNode)
    await flushPromises()
    expect($fetchMock).toHaveBeenCalledTimes(2)

    await component.find('[data-testid="graph-error-dismiss"]').trigger('click')
    expect(component.find('[data-testid="graph-error"]').exists()).toBe(false)
  })
})
