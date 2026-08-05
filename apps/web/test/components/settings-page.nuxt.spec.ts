import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../app/pages/settings.vue'

const { useFetchMock, $fetchMock, navigateToMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
  navigateToMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('navigateTo', () => navigateToMock)

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
  if (url === '/api/ingestion/status') {
    return {
      data: ref({ queue: null }) as Ref<unknown>,
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

function mockSteadyStateResponse() {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/notes/status-counts')
      return mockUseFetch(url)
    if (url === '/api/synced-folders')
      return { data: ref([]) as Ref<unknown[]>, pending: ref(false), refresh: vi.fn() }
    if (url === '/api/ingestion/status')
      return { data: ref({ queue: null }) as Ref<unknown>, pending: ref(false), refresh: vi.fn() }
    return {
      data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' } } }) as Ref<{ settings: Record<string, { value: string | number, source: 'workspace' | 'default' }> }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

describe('settings page', () => {
  it('redirects to folders when onboarding is complete', async () => {
    mockSteadyStateResponse()

    await mountSuspended(SettingsPage)

    expect(navigateToMock).toHaveBeenCalledWith('/settings/folders', { replace: true })
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
    mockWizardResponse({}, [{ id: '1', path: '/notes', basename: 'notes', noteCount: 0 }])

    const component = await mountSuspended(SettingsPage)
    const llmStep = component.find('[data-testid="wizard-step-llm"]')

    expect(llmStep.attributes('disabled')).toBeUndefined()
  })
})
