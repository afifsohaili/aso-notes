import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import LlmRoleCard from '../../app/components/settings/llm-role-card.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

useFetchMock.mockImplementation(() => ({
  data: ref(null) as Ref<unknown>,
  pending: ref(false),
  refresh: vi.fn(),
}))

describe('llm role card', () => {
  it('renders the role title and help text', async () => {
    const component = await mountSuspended(LlmRoleCard, {
      props: {
        role: 'agent',
        provider: 'openrouter',
        model: '',
        available: { openrouter: true, ollama: false },
      },
    })

    expect(component.text()).toContain('Agent answers')
    expect(component.text()).toContain('Answers your questions in chat.')
  })

  it('disables unavailable providers and marks them as missing', async () => {
    const component = await mountSuspended(LlmRoleCard, {
      props: {
        role: 'embedding',
        provider: 'openrouter',
        model: '',
        available: { openrouter: true, ollama: false },
      },
    })

    const option = component.find('option[value="ollama"]')
    expect(option.attributes('disabled')).toBeDefined()
    expect(option.text()).toContain('(API key missing)')
  })

  it('emits update:model when the model input changes', async () => {
    const component = await mountSuspended(LlmRoleCard, {
      props: {
        role: 'extraction',
        provider: 'openrouter',
        model: '',
        available: { openrouter: true, ollama: true },
      },
    })

    await component.find('input#extraction-model').setValue('anthropic/claude-3-5-sonnet')

    expect(component.emitted('update:model')).toHaveLength(1)
    expect(component.emitted('update:model')?.[0]).toEqual(['anthropic/claude-3-5-sonnet'])
  })

  it('disables the test button when the model is empty', async () => {
    const component = await mountSuspended(LlmRoleCard, {
      props: {
        role: 'agent',
        provider: 'openrouter',
        model: '',
        available: { openrouter: true, ollama: true },
      },
    })

    const testButton = component.findAll('button').find(b => b.text() === 'Test connection')
    expect(testButton?.exists()).toBe(true)
    expect(testButton?.attributes('disabled')).toBeDefined()
  })

  it('shows the OK status after a successful test', async () => {
    const component = await mountSuspended(LlmRoleCard, {
      props: {
        role: 'agent',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        available: { openrouter: true, ollama: true },
        testStatus: { kind: 'ok' },
      },
    })

    expect(component.find('[data-testid="llm-test-ok"]').exists()).toBe(true)
  })
})
