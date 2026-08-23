import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsLlmProvidersPage from '../../app/pages/settings/llm-providers.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

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

describe('settings llm providers page — embedding model switch warning', () => {
  beforeEach(() => {
    $fetchMock.mockClear()
  })

  function mockEmbeddingChangeResponse() {
    useFetchMock.mockImplementation((url: string) => {
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
      if (url === '/api/synced-folders')
        return { data: ref([]) as Ref<unknown[]>, pending: ref(false), refresh: vi.fn() }
      if (url === '/api/ingestion/status')
        return { data: ref({ queue: null }) as Ref<unknown>, pending: ref(false), refresh: vi.fn() }
      return {
        data: ref({
          settings: {
            'onboarding.completed_at': { value: '2026-01-01T00:00:00Z', source: 'workspace' },
            'llm.embedding.provider': { value: 'openrouter', source: 'workspace' },
            'llm.embedding.model': { value: 'model-a', source: 'workspace' },
          },
        }) as Ref<{ settings: Record<string, { value: string | number, source: 'workspace' | 'default' }> }>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    })
  }

  async function showEmbeddingSave(component: ReturnType<typeof mountSuspended<typeof SettingsLlmProvidersPage>> extends Promise<infer T> ? T : never) {
    // The embedding role card is the one whose heading is "Embeddings".
    const cards = component.findAll('.rounded-lg.border.border-gray-200.bg-white.p-5')
    const embeddingCard = cards.find(c => c.text().includes('Embeddings'))
    if (!embeddingCard)
      throw new Error('no embedding card found')
    const saveButton = embeddingCard.findAll('button').find(b => b.text().trim().length > 0 && !b.text().includes('Test connection'))
    if (!saveButton)
      throw new Error('no Save button found')
    await saveButton.trigger('click')
    await flushPromises()
  }

  it('opens the warning dialog when the embedding model changes before saving', async () => {
    mockEmbeddingChangeResponse()
    $fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/settings/test-connection'))
        return { ok: true }
      return { ok: true }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)

    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(true)
    // nothing was saved or rebuilt yet
    const settingsCalls = $fetchMock.mock.calls.filter(([url]) => url === '/api/settings')
    expect(settingsCalls).toHaveLength(0)
    const rebuildCalls = $fetchMock.mock.calls.filter(([url]) => url === '/api/settings/rebuild')
    expect(rebuildCalls).toHaveLength(0)
  })

  it('does not open the dialog when the embedding model is unchanged', async () => {
    mockEmbeddingChangeResponse()
    $fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/settings/test-connection'))
        return { ok: true }
      return { ok: true }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)

    await showEmbeddingSave(component)

    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)
  })

  it('on confirm saves the model setting and triggers rebuild', async () => {
    mockEmbeddingChangeResponse()
    $fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/settings/test-connection'))
        return { ok: true }
      return { ok: true }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)

    await component.find('[data-testid="embedding-model-switch-confirm"]').trigger('click')
    await flushPromises()

    const patchCalls = $fetchMock.mock.calls.filter(([url]) => url === '/api/settings')
    expect(patchCalls.length).toBeGreaterThan(0)
    expect(patchCalls).toEqual(expect.arrayContaining([
      ['/api/settings', { method: 'PATCH', body: { key: 'llm.embedding.model', value: 'model-b' } }],
    ]))
    const rebuildCalls = $fetchMock.mock.calls.filter(([url]) => url === '/api/settings/rebuild')
    expect(rebuildCalls).toHaveLength(1)
    expect(rebuildCalls[0]).toEqual(['/api/settings/rebuild', { method: 'POST' }])
  })

  it('on cancel, saves nothing and triggers no rebuild', async () => {
    mockEmbeddingChangeResponse()
    $fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/settings/test-connection'))
        return { ok: true }
      return { ok: true }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)

    await component.find('[data-testid="embedding-model-switch-cancel"]').trigger('click')
    await flushPromises()

    expect($fetchMock.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(0)
    expect($fetchMock.mock.calls.filter(([url]) => url === '/api/settings/rebuild')).toHaveLength(0)
    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)
  })
})
