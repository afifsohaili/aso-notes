import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsExtractionPage from '../../app/pages/settings/extraction.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockSettingsResponse(settings: Record<string, { value: string | number, source: 'workspace' | 'default' }>) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/notes/status-counts') {
      return {
        data: ref({ pending: 0, queued: 0, processing: 0, ingested: 0, failed: 0 }) as Ref<{ pending: number, queued: number, processing: number, ingested: number, failed: number }>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    }
    return {
      data: ref({ settings }) as Ref<{ settings: typeof settings }>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

describe('settings extraction page', () => {
  it('renders the vocabulary strategy select', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
    })

    const component = await mountSuspended(SettingsExtractionPage)
    expect(component.find('select#vocabulary-strategy').exists()).toBe(true)
  })

  it('shows the threshold input when blind-merge is selected', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'blind-merge', source: 'workspace' },
      'extraction.blind_merge_threshold': { value: 0.9, source: 'workspace' },
    })

    const component = await mountSuspended(SettingsExtractionPage)
    expect(component.find('input#merge-threshold').exists()).toBe(true)
  })

  it('keeps the rebuild confirm button disabled until REBUILD is typed', async () => {
    mockSettingsResponse({
      'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
      'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
    })

    const component = await mountSuspended(SettingsExtractionPage)
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

    const component = await mountSuspended(SettingsExtractionPage)
    await component.find('[data-testid="rebuild-open-button"]').trigger('click')

    const input = component.find('[data-testid="rebuild-confirm-input"]')
    await input.setValue('REBUILD')

    const confirmButton = component.find('[data-testid="rebuild-confirm-button"]')
    await confirmButton.trigger('click')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/settings/rebuild', { method: 'POST' })
    expect(component.find('p[role="status"]').exists()).toBe(true)
  })
})
