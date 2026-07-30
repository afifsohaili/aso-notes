import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ChatIndexPage from '../../app/pages/chat/index.vue'

const { useFetchMock, useRouteMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  useRouteMock: vi.fn(() => ({
    path: '/chat',
    fullPath: '/chat',
    hash: '',
    query: {},
    params: {},
    meta: {},
    matched: [],
    redirectedFrom: undefined,
    name: undefined,
  })),
}))

mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('useRoute', () => useRouteMock)

function mockUseFetch(url: string | (() => string | null)) {
  const resolved = typeof url === 'function' ? url() : url
  if (resolved === '/api/notes/status-counts') {
    return {
      data: ref({ pending: 0, queued: 0, processing: 0, ingested: 0, failed: 0 }) as Ref<{ pending: number, queued: number, processing: number, ingested: number, failed: number }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  }
  if (resolved === '/api/conversations' || resolved === '/api/conversations?archived=true') {
    return {
      data: ref([]) as Ref<unknown[]>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  }
  return {
    data: ref(null) as Ref<unknown>,
    pending: ref(false),
    refresh: vi.fn(),
  }
}

describe('chat index first-run empty state', () => {
  it('renders the first-query title and suggestions when no messages exist', async () => {
    useFetchMock.mockImplementation(mockUseFetch)

    const component = await mountSuspended(ChatIndexPage)

    expect(component.text()).toContain('What would you like to know?')
    expect(component.text()).toContain('What can you do with my notes?')
    expect(component.text()).toContain('What should I write about next?')
  })

  it('offers the with-notes suggestion when notes are already ingested', async () => {
    useFetchMock.mockImplementation((url: string | (() => string | null)) => {
      const resolved = typeof url === 'function' ? url() : url
      if (resolved === '/api/notes/status-counts') {
        return {
          data: ref({ pending: 0, queued: 0, processing: 0, ingested: 5, failed: 0 }) as Ref<{ pending: number, queued: number, processing: number, ingested: number, failed: number }>,
          pending: ref(false),
          refresh: vi.fn(),
        }
      }
      return mockUseFetch(url)
    })

    const component = await mountSuspended(ChatIndexPage)

    expect(component.text()).toContain('Summarize the main themes across my notes')
    expect(component.text()).not.toContain('What can you do with my notes?')
  })
})
