import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ConsolidationBudgetCard from '../../app/components/settings/consolidation/budget-card.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

function mockSettingsResponse(budget = 200) {
  useFetchMock.mockImplementation((url: unknown) => {
    const resolved = typeof url === 'function' ? url() : url
    if (resolved === '/api/settings') {
      return {
        data: ref({ settings: { 'consolidation.run_budget': { value: budget, source: 'default' } } }) as Ref<unknown>,
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

beforeEach(() => {
  $fetchMock.mockReset()
})

describe('consolidation budget card', () => {
  it('renders the current budget value', async () => {
    mockSettingsResponse(250)
    $fetchMock.mockResolvedValue({ ok: true })

    const component = await mountSuspended(ConsolidationBudgetCard)

    const input = component.find('input[type="number"]')
    expect((input.element as HTMLInputElement).value).toBe('250')
  })

  it('saves the budget on submit', async () => {
    mockSettingsResponse(200)
    $fetchMock.mockResolvedValue({ ok: true })

    const component = await mountSuspended(ConsolidationBudgetCard)

    const input = component.find('input[type="number"]')
    await input.setValue('300')
    await component.find('form').trigger('submit')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      body: { key: 'consolidation.run_budget', value: 300 },
    })
  })

  it('shows a saved state after a successful save', async () => {
    mockSettingsResponse(200)
    $fetchMock.mockResolvedValue({ ok: true })

    const component = await mountSuspended(ConsolidationBudgetCard)

    await component.find('input[type="number"]').setValue('300')
    await component.find('form').trigger('submit')
    await flushPromises()

    expect(component.find('[data-testid="budget-saved-message"]').exists()).toBe(true)
  })

  it('shows an error state when the save fails', async () => {
    mockSettingsResponse(200)
    $fetchMock.mockRejectedValue(new Error('network'))

    const component = await mountSuspended(ConsolidationBudgetCard)

    await component.find('input[type="number"]').setValue('300')
    await component.find('form').trigger('submit')
    await flushPromises()

    expect(component.find('[data-testid="budget-error-message"]').exists()).toBe(true)
  })
})
