import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../app/pages/settings.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

function mockSettingsResponse(settings: Record<string, { value: string | number, source: 'workspace' | 'default' }>) {
  useFetchMock.mockReturnValue({
    data: ref({ settings }) as Ref<{ settings: typeof settings }>,
    pending: ref(false),
    refresh: vi.fn(),
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
})
