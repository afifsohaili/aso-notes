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

  function stubOkFetch() {
    $fetchMock.mockImplementation(async () => ({ ok: true }))
  }

  async function showEmbeddingSave(component: ReturnType<typeof mountSuspended<typeof SettingsLlmProvidersPage>> extends Promise<infer T> ? T : never) {
    const embeddingCard = component.find('[data-testid="llm-role-card-embedding"]')
    if (!embeddingCard.exists())
      throw new Error('no embedding card found')
    const saveButton = embeddingCard.find('[data-testid="llm-role-save"]')
    if (!saveButton.exists())
      throw new Error('no Save button found')
    await saveButton.trigger('click')
    await flushPromises()
  }

  it('opens the warning dialog when the embedding model changes before saving', async () => {
    mockEmbeddingChangeResponse()
    stubOkFetch()

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
    stubOkFetch()

    const component = await mountSuspended(SettingsLlmProvidersPage)

    await showEmbeddingSave(component)

    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)
  })

  it('on confirm saves the model setting and triggers rebuild', async () => {
    mockEmbeddingChangeResponse()
    stubOkFetch()

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
    stubOkFetch()

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)

    await component.find('[data-testid="embedding-model-switch-cancel"]').trigger('click')
    await flushPromises()

    expect($fetchMock.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(0)
    expect($fetchMock.mock.calls.filter(([url]) => url === '/api/settings/rebuild')).toHaveLength(0)
    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)
  })

  it('dismissing the dialog by backdrop click behaves as cancel (no save, no rebuild)', async () => {
    mockEmbeddingChangeResponse()
    stubOkFetch()

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)

    // Click the dimmed backdrop (not the dialog panel) to dismiss.
    await component.find('[data-testid="embedding-model-switch-dialog"]').trigger('click')
    await flushPromises()

    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)
    const patchCalls = $fetchMock.mock.calls.filter(([url, init]) => url === '/api/settings' && init?.method === 'PATCH')
    expect(patchCalls).toHaveLength(0)
    expect($fetchMock.mock.calls.filter(([url]) => url === '/api/settings/rebuild')).toHaveLength(0)
  })

  it('on rebuild failure, keeps the dialog open, shows the inline error, and rolls back the model PATCH', async () => {
    mockEmbeddingChangeResponse()
    $fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/settings/test-connection'))
        return { ok: true }
      if (url === '/api/settings/rebuild')
        throw new Error('rebuild exploded')
      return { ok: true }
    })

    const component = await mountSuspended(SettingsLlmProvidersPage)
    await component.find('input#embedding-model').setValue('model-b')

    await showEmbeddingSave(component)
    await component.find('[data-testid="embedding-model-switch-confirm"]').trigger('click')
    await flushPromises()

    // dialog stays open and surfaces the real rebuild error
    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(true)
    expect(component.find('[role="alert"]').text()).toContain('rebuild exploded')
    // the saved model was rolled back to the previously-saved value
    const patchCalls = $fetchMock.mock.calls.filter(([url, init]) => url === '/api/settings' && init?.method === 'PATCH')
    expect(patchCalls).toEqual(expect.arrayContaining([
      ['/api/settings', { method: 'PATCH', body: { key: 'llm.embedding.model', value: 'model-a' } }],
    ]))
  })

  it('re-opens the warning dialog when switching back after a successful A->B->A switch (guard sees the new saved model)', async () => {
    mockEmbeddingChangeResponse()
    stubOkFetch()

    const component = await mountSuspended(SettingsLlmProvidersPage)

    // A -> B, confirm
    await component.find('input#embedding-model').setValue('model-b')
    await showEmbeddingSave(component)
    await component.find('[data-testid="embedding-model-switch-confirm"]').trigger('click')
    await flushPromises()
    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(false)

    // B -> A: the guard must now see B as the saved model and warn again
    await component.find('input#embedding-model').setValue('model-a')
    await showEmbeddingSave(component)
    expect(component.find('[data-testid="embedding-model-switch-dialog"]').exists()).toBe(true)
  })
})
