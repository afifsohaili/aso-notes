import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import NotesCatchAllPage from '../../app/pages/notes/[...path].vue'

const { useAsyncDataMock, useRouteMock, navigateToMock, $fetchMock, makeRoute } = vi.hoisted(() => {
  function makeRoute(params: Record<string, string[]>, query: Record<string, string> = {}) {
    return {
      path: '/notes/project-a',
      fullPath: '/notes/project-a',
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
    useAsyncDataMock: vi.fn(),
    useRouteMock: vi.fn(() => makeRoute({ path: [] })),
    navigateToMock: vi.fn(),
    $fetchMock: vi.fn(),
    makeRoute,
  }
})

mockNuxtImport('useAsyncData', () => useAsyncDataMock)
mockNuxtImport('useRoute', () => useRouteMock)
mockNuxtImport('navigateTo', () => navigateToMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockRoute(params: Record<string, string[]>, query: Record<string, string> = {}) {
  useRouteMock.mockReturnValue(makeRoute(params, query))
}

const baseNote = {
  path: '/project-a/plan.md',
  title: 'Plan',
  status: 'ingested',
  tags: [],
  updatedAt: new Date().toISOString(),
  lastRun: null,
}

const baseNoteDetail = {
  path: '/project-a/plan.md',
  title: 'Plan',
  content: '# Plan\n\nStart here.',
  renderMarkdown: true,
  status: 'ingested',
  folder: '/project-a',
  tags: [],
  sources: [],
  updatedAt: new Date().toISOString(),
  lastRun: null,
}

function mockAsyncDataForNote() {
  useAsyncDataMock.mockImplementation(() => ({
    data: ref({
      resolved: { type: 'note', path: '/project-a/plan.md', folder: '/project-a' },
      folders: [{ name: 'project-a', path: '/project-a', hasCover: false, noteCount: 1, children: [] }],
      notes: [baseNote],
      note: baseNoteDetail,
      selectedFolderPath: '/project-a',
      selectedNotePath: '/project-a/plan.md',
    }) as Ref<unknown>,
    error: ref(null),
    refresh: vi.fn(),
  }))
}

function mockAsyncDataForFolder() {
  useAsyncDataMock.mockImplementation(() => ({
    data: ref({
      resolved: { type: 'folder', path: '/project-a' },
      folders: [{ name: 'project-a', path: '/project-a', hasCover: false, noteCount: 1, children: [] }],
      notes: [baseNote],
      note: null,
      selectedFolderPath: '/project-a',
      selectedNotePath: null,
    }) as Ref<unknown>,
    error: ref(null),
    refresh: vi.fn(),
  }))
}

describe('notes catch-all page', () => {
  it('renders note detail when the path resolves to a note', async () => {
    mockRoute({ path: ['project-a', 'plan.md'] })
    mockAsyncDataForNote()

    const component = await mountSuspended(NotesCatchAllPage)
    const html = component.html()

    expect(html).toContain('Plan')
    expect(html).toContain('Start here')
  })

  it('renders folder selection when the path resolves to a folder', async () => {
    mockRoute({ path: ['project-a'] })
    mockAsyncDataForFolder()

    const component = await mountSuspended(NotesCatchAllPage)
    const html = component.html()

    expect(html).toContain('project-a')
    expect(html).toContain('Plan')
  })

  it('navigates to a note when a note is selected in the list', async () => {
    mockRoute({ path: ['project-a'] })
    mockAsyncDataForFolder()

    const component = await mountSuspended(NotesCatchAllPage)
    await flushPromises()

    const noteItem = component.find('[data-testid="note-list-item"]')
    expect(noteItem.exists()).toBe(true)
    await noteItem.trigger('click')

    expect(navigateToMock).toHaveBeenCalledWith('/notes/project-a/plan.md')
  })

  it('navigates to a folder when a folder is selected in the tree', async () => {
    mockRoute({ path: ['project-a'] })
    mockAsyncDataForFolder()

    const component = await mountSuspended(NotesCatchAllPage)
    await flushPromises()

    const folderItem = component.find('[data-testid="folder-tree-row"]')
    expect(folderItem.exists()).toBe(true)
    await folderItem.trigger('click')

    expect(navigateToMock).toHaveBeenCalledWith('/notes/project-a')
  })
})
