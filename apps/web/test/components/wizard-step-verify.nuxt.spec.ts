import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WizardStepVerify from '../../app/components/settings/wizard-step-verify.vue'

const { $fetchMock } = vi.hoisted(() => ({
  $fetchMock: vi.fn(),
}))

vi.stubGlobal('$fetch', $fetchMock)

function mockFetchSequence(states: Array<{ phase: string, error?: string, lastRun?: unknown }>) {
  let index = 0
  $fetchMock.mockImplementation(async (url: string, opts?: any) => {
    if (url === '/api/onboarding/smoke-test' && opts?.method === 'POST') {
      return { attemptId: 'attempt-1', phase: 'written' }
    }
    if (url === '/api/onboarding/smoke-test') {
      const state = states[index] ?? states[states.length - 1]
      index = Math.min(index + 1, states.length - 1)
      return state
    }
    throw new Error(`unexpected call: ${url}`)
  })
}

describe('wizard step verify', () => {
  it('is disabled until prerequisites are met', async () => {
    $fetchMock.mockRejectedValue(new Error('should not call'))
    const component = await mountSuspended(WizardStepVerify, {
      props: { hasFolder: false, hasRedis: true, llmConfigured: true },
    })

    expect(component.text()).toContain('Add a Synced Folder first')
    expect(component.find('[data-testid="run-smoke-test"]').exists()).toBe(false)
  })

  it('starts a smoke test when the run button is clicked', async () => {
    $fetchMock.mockResolvedValueOnce({ attemptId: 'attempt-1', phase: 'written' })
    $fetchMock.mockResolvedValue({ phase: 'written' })

    const component = await mountSuspended(WizardStepVerify, {
      props: { hasFolder: true, hasRedis: true, llmConfigured: true },
    })

    await component.find('[data-testid="run-smoke-test"]').trigger('click')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith('/api/onboarding/smoke-test', { method: 'POST' })
  })

  it('shows the done state and emits complete', async () => {
    vi.useFakeTimers()
    mockFetchSequence([{ phase: 'done' }])

    const component = await mountSuspended(WizardStepVerify, {
      props: { hasFolder: true, hasRedis: true, llmConfigured: true },
    })

    await component.find('[data-testid="run-smoke-test"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect(component.emitted('complete')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('shows failure detail and a retry button', async () => {
    vi.useFakeTimers()
    mockFetchSequence([{ phase: 'failed', error: 'extraction model is down', lastRun: { status: 'failed' } }])

    const component = await mountSuspended(WizardStepVerify, {
      props: { hasFolder: true, hasRedis: true, llmConfigured: true },
    })

    await component.find('[data-testid="run-smoke-test"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect(component.text()).toContain('extraction model is down')
    expect(component.text()).toContain('Retry')
    vi.useRealTimers()
  })
})
