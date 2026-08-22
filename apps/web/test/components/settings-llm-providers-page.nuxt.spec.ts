import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SettingsLlmProvidersPage from '../../app/pages/settings/llm-providers.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

function mockLlmProvidersResponse(settings: Record<string, { value: string | number, source: 'workspace' | 'default' }> = {}) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/settings') {
      return {
        data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' }, ...settings } }) as Ref<{ settings: typeof settings }>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    }
    if (url === '/api/settings/providers') {
      return {
        data: ref({
          providers: {
            agent: { openrouter: true, ollama: true, omlx: true },
            extraction: { openrouter: true, ollama: true, omlx: true },
            embedding: { openrouter: true, ollama: true, omlx: true },
          },
        }) as Ref<unknown>,
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
  })
}

describe('settings llm providers page', () => {
  it('renders the role cards for all three roles', async () => {
    mockLlmProvidersResponse()

    const component = await mountSuspended(SettingsLlmProvidersPage)

    expect(component.text()).toContain('Agent answers')
    expect(component.text()).toContain('Graph extraction')
    expect(component.text()).toContain('Embeddings')
  })

  it('renders the re-verify section', async () => {
    mockLlmProvidersResponse()

    const component = await mountSuspended(SettingsLlmProvidersPage)

    expect(component.text()).toContain('Re-verify setup')
    expect(component.find('[data-testid="reverify-open-button"]').exists()).toBe(true)
  })

  it('renders an oMLX provider option for each role', async () => {
    mockLlmProvidersResponse()

    const component = await mountSuspended(SettingsLlmProvidersPage)

    const options = component.findAll('option[value="omlx"]')
    expect(options.length).toBe(3)
    for (const option of options)
      expect(option.text()).toContain('oMLX')
  })

  it('defaults to omlx availability when the providers payload is missing', async () => {
    useFetchMock.mockImplementation((url: string) => {
      if (url === '/api/settings/providers')
        return { data: ref(null) as Ref<unknown>, pending: ref(false), refresh: vi.fn() }
      if (url === '/api/synced-folders')
        return { data: ref([]) as Ref<unknown[]>, pending: ref(false), refresh: vi.fn() }
      if (url === '/api/ingestion/status')
        return { data: ref({ queue: null }) as Ref<unknown>, pending: ref(false), refresh: vi.fn() }
      return {
        data: ref({ settings: { 'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' } } }) as Ref<unknown>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)

    const options = component.findAll('option[value="omlx"]')
    expect(options.length).toBe(3)
    for (const option of options)
      expect(option.attributes('disabled')).toBeUndefined()
  })
})
