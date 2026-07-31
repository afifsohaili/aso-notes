import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import NotesLayout from '../../app/components/notes/notes-layout.vue'
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

const routeState = reactive({ query: {} as Record<string, string> })

function mockRoute(query: Record<string, string> = {}, params: Record<string, string[]> = {}) {
  routeState.query = query
  useRouteMock.mockImplementation(() => ({
    ...makeRoute(query, params),
    get query() { return routeState.query },
  }))
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

  it('updates the selection when the syncedFolder route query changes (folder click navigates)', async () => {
    mockRoute({ syncedFolder: 'sf-1' })
    mockFetch()

    const component = await mountSuspended(NotesIndexPage)
    await flushPromises()
    const layout = component.findComponent(NotesLayout)

    expect(layout.props('selectedSyncedFolderId')).toBe('sf-1')
    expect(layout.props('selectedFolderPath')).toBe('/')

    // Clicking another synced folder row emits selectFolder → navigateTo →
    // the router applies the new query. The page must follow the route.
    await layout.vm.$emit('selectFolder', 'sf-2', '/')
    expect(navigateToMock).toHaveBeenCalledWith('/notes?syncedFolder=sf-2')
    routeState.query = { syncedFolder: 'sf-2' }
    await flushPromises()

    expect(layout.props('selectedSyncedFolderId')).toBe('sf-2')
    expect(layout.props('selectedFolderPath')).toBe('/')
  })
})
