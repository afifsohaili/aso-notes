import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../app/pages/settings.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockUseFetch(url: string) {
  if (url === '/api/notes/status-counts') {
    return {
      data: ref({ pending: 0, queued: 0, processing: 0, ingested: 0, failed: 0 }) as Ref<{ pending: number, queued: number, processing: number, ingested: number, failed: number }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  }
  if (url === '/api/synced-folders') {
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

function mockSettingsResponse(settings: Record<string, { value: string | number, source: 'workspace' | 'default' }>) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/notes/status-counts')
      return mockUseFetch(url)
    return {
      data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' }, ...settings } }) as Ref<{ settings: typeof settings }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

function mockWizardResponse(settings: Record<string, { value: string | number, source: 'workspace' | 'default' }> = {}, folders: unknown[] = []) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/notes/status-counts')
      return mockUseFetch(url)
    if (url === '/api/synced-folders')
      return { data: ref(folders) as Ref<unknown[]>, pending: ref(false), refresh: vi.fn() }
    if (url === '/api/ingestion/status')
      return { data: ref({ queue: null }) as Ref<unknown>, pending: ref(false), refresh: vi.fn() }
    return {
      data: ref({ settings }) as Ref<{ settings: typeof settings }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

describe('settings page', () => {
  it('renders the vocabulary strategy select', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
    })

    const component = await mountSuspended(SettingsPage)
    expect(component.find('select#vocabulary-strategy').exists()).toBe(true)
  })

  it('shows the threshold input when blind-merge is selected', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'blind-merge', source: 'workspace' },
      'extraction.blind_merge_threshold': { value: 0.9, source: 'workspace' },
    })

    const component = await mountSuspended(SettingsPage)
    expect(component.find('input#merge-threshold').exists()).toBe(true)
  })

  it('keeps the rebuild confirm button disabled until REBUILD is typed', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
    })

    const component = await mountSuspended(SettingsPage)
    await component.find('[data-testid="rebuild-open-button"]').trigger('click')

    const confirmButton = component.find('[data-testid="rebuild-confirm-button"]')
    const input = component.find('[data-testid="rebuild-confirm-input"]')
    expect(confirmButton.attributes('disabled')).toBeDefined()

    await input.setValue('rebuild')
    expect(confirmButton.attributes('disabled')).toBeDefined()

    await input.setValue('REBUILD')
    expect(confirmButton.attributes('disabled')).toBeUndefined()
  })

  it('shows success feedback after a confirmed rebuild POST', async () => {
    $fetchMock.mockResolvedValue({ ok: true })
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
    })

    const component = await mountSuspended(SettingsPage)
    await component.find('[data-testid="rebuild-open-button"]').trigger('click')

    const input = component.find('[data-testid="rebuild-confirm-input"]')
    await input.setValue('REBUILD')

    const confirmButton = component.find('[data-testid="rebuild-confirm-button"]')
    await confirmButton.trigger('click')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/settings/rebuild', { method: 'POST' })
    expect(component.find('p[role="status"]').exists()).toBe(true)
  })

  it('renders the synced folders description only once', async () => {
    mockSettingsResponse({})

    const component = await mountSuspended(SettingsPage)
    const matches = component.text().match(/Top-level folders on disk that the app watches and syncs\./g)

    expect(matches).toHaveLength(1)
  })

  it('patches the alias and refreshes the folder list after saving', async () => {
    $fetchMock.mockResolvedValue({ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', alias: 'Work' })
    const refreshFolders = vi.fn()
    useFetchMock.mockImplementation((url: string) => {
      if (url === '/api/notes/status-counts')
        return mockUseFetch(url)
      if (url === '/api/synced-folders') {
        return {
          data: ref([{ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', noteCount: 2, alias: null }]) as Ref<unknown[]>,
          pending: ref(false),
          refresh: refreshFolders,
        }
      }
      return {
        data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' } } }) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })

    const component = await mountSuspended(SettingsPage)
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
      if (url === '/api/notes/status-counts')
        return mockUseFetch(url)
      if (url === '/api/synced-folders') {
        return {
          data: ref([{ id: 'f1', path: '/Users/afifsohaili/Projects/justjom/', noteCount: 2, alias: null }]) as Ref<unknown[]>,
          pending: ref(false),
          refresh: vi.fn(),
        }
      }
      return {
        data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' } } }) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })

    const component = await mountSuspended(SettingsPage)
    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    await component.find('[data-testid="alias-input"]').setValue('x'.repeat(81))
    await component.find('[data-testid="alias-save-button"]').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('Alias must be 80 characters or fewer.')
  })
})

describe('settings wizard mode', () => {
  it('renders the wizard title when onboarding has not been completed', async () => {
    mockWizardResponse()

    const component = await mountSuspended(SettingsPage)

    expect(component.text()).toContain('Welcome — let\'s get you set up')
    expect(component.text()).toContain('Three quick steps and your notes will be ready to talk to.')
  })

  it('shows the redis warning and starts on the folder step', async () => {
    mockWizardResponse()

    const component = await mountSuspended(SettingsPage)

    expect(component.text()).toContain('Redis is not connected.')
    expect(component.find('[data-testid="wizard-step-folder"]').exists()).toBe(true)
    expect(component.text()).toContain('Add a Synced Folder')
  })

  it('keeps the LLM step disabled until a folder is added', async () => {
    mockWizardResponse()

    const component = await mountSuspended(SettingsPage)
    const llmStep = component.find('[data-testid="wizard-step-llm"]')

    expect(llmStep.attributes('disabled')).toBeDefined()
  })

  it('enables the LLM step once a synced folder exists', async () => {
    mockWizardResponse({}, [{ id: '1', path: '/notes', noteCount: 0 }])

    const component = await mountSuspended(SettingsPage)
    const llmStep = component.find('[data-testid="wizard-step-llm"]')

    expect(llmStep.attributes('disabled')).toBeUndefined()
  })
})
