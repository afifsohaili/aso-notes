import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import NotesIndexPage from '../../app/pages/notes/index.vue'

const { useFetchMock, useRouteMock, navigateToMock, $fetchMock, makeRoute } = vi.hoisted(() => {
  function makeRoute(query: Record<string, string> = {}, params: Record<string, string[]> = {}) {
    return {
      path: '/notes',
      fullPath: '/notes',
      hash: '',
      query,
      params,
      meta: {},
      matched: [],
      redirectedFrom: undefined,
      name: undefined,
    }
  }
  return {
    useFetchMock: vi.fn(),
    useRouteMock: vi.fn(() => makeRoute()),
    navigateToMock: vi.fn(),
    $fetchMock: vi.fn(),
    makeRoute,
  }
})

mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('useRoute', () => useRouteMock)
mockNuxtImport('navigateTo', () => navigateToMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockRoute(query: Record<string, string> = {}, params: Record<string, string[]> = {}) {
  useRouteMock.mockReturnValue(makeRoute(query, params))
}

function mockFetch() {
  useFetchMock.mockImplementation(() => ({
    data: ref([]) as Ref<unknown>,
    pending: ref(false),
    refresh: vi.fn(),
  }))
}

describe('notes index page', () => {
  it('redirects old ?note= URLs to the canonical path', async () => {
    mockRoute({ note: '/project-a/plan.md' })
    mockFetch()

    await mountSuspended(NotesIndexPage)
    await flushPromises()

    expect(navigateToMock).toHaveBeenCalledWith('/notes/project-a/plan.md', { replace: true })
  })

  it('renders the default three-pane layout without a selection', async () => {
    mockRoute({})
    mockFetch()

    const component = await mountSuspended(NotesIndexPage)
    const html = component.html()

    expect(html).toContain('Folders')
    expect(html).toContain('Notes')
    expect(html).toContain('Select a note')
  })
})
