import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsFoldersPage from '../../app/pages/settings/folders.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockFoldersResponse(folders: unknown[] = []) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/synced-folders') {
      return {
        data: ref(folders) as Ref<unknown[]>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    }
    return {
      data: ref(null) as Ref<unknown>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

describe('settings folders page', () => {
  it('renders the synced folders description', async () => {
    mockFoldersResponse()

    const component = await mountSuspended(SettingsFoldersPage)
    const matches = component.text().match(/Top-level folders on disk that the app watches and syncs\./g)

    expect(matches).toHaveLength(1)
  })

  it('patches the alias and refreshes the folder list after saving', async () => {
    $fetchMock.mockResolvedValue({ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', alias: 'Work' })
    const refreshFolders = vi.fn()
    useFetchMock.mockImplementation((url: string) => {
      if (url === '/api/synced-folders') {
        return {
          data: ref([{ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 2, alias: null }]) as Ref<unknown[]>,
          pending: ref(false),
          refresh: refreshFolders,
        }
      }
      return {
        data: ref(null) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })

    const component = await mountSuspended(SettingsFoldersPage)
    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    await component.find('[data-testid="alias-input"]').setValue('Work')
    await component.find('[data-testid="alias-save-button"]').trigger('click')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/synced-folders/f1', {
      method: 'PATCH',
      body: { alias: 'Work' },
    })
    expect(refreshFolders).toHaveBeenCalled()
  })

  it('shows an inline error when the alias patch is rejected with 400', async () => {
    $fetchMock.mockRejectedValue(Object.assign(new Error('too long'), { statusCode: 400 }))
    useFetchMock.mockImplementation((url: string) => {
      if (url === '/api/synced-folders') {
        return {
          data: ref([{ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 2, alias: null }]) as Ref<unknown[]>,
          pending: ref(false),
          refresh: vi.fn(),
        }
      }
      return {
        data: ref(null) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })

    const component = await mountSuspended(SettingsFoldersPage)
    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    await component.find('[data-testid="alias-input"]').setValue('x'.repeat(81))
    await component.find('[data-testid="alias-save-button"]').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('Alias must be 80 characters or fewer.')
  })
})
