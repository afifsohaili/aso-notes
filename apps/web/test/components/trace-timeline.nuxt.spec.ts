import type { TraceGeneration, TraceToolCall } from '../../app/components/observability/trace-timeline.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TraceTimeline from '../../app/components/observability/trace-timeline.vue'

const generation: TraceGeneration = {
  id: 'g-1',
  seq: 1,
  llmUseCase: 'agent',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4.5',
  prompt: [{ role: 'user', content: 'Hello' }],
  response: { role: 'assistant', content: 'Hi' },
  promptTokens: 10,
  completionTokens: 20,
  costUsd: '0.000123',
  latencyMs: 800,
  finishReason: 'stop',
  error: null,
  prunedAt: null,
  usageMissing: false,
  createdAt: '2026-08-10T09:00:00.000Z',
}

const toolCall: TraceToolCall = {
  id: 'tc-1',
  seq: 0,
  name: 'search_notes',
  input: { query: 'graph rag' },
  output: { results: [{ path: '/a.md' }] },
  durationMs: 210,
  status: 'completed',
  prunedAt: null,
  createdAt: '2026-08-10T09:00:00.000Z',
}

const prunedGeneration: TraceGeneration = {
  ...generation,
  id: 'g-2',
  seq: 2,
  prompt: null,
  response: null,
  prunedAt: '2026-08-11T09:00:00.000Z',
}

const prunedToolCall: TraceToolCall = {
  ...toolCall,
  id: 'tc-2',
  seq: 3,
  name: 'read_note',
  output: null,
  prunedAt: '2026-08-11T09:00:00.000Z',
}

describe('trace-timeline', () => {
  it('renders all steps expanded by default', async () => {
    const component = await mountSuspended(TraceTimeline, {
      props: {
        generations: [generation],
        toolCalls: [toolCall],
      },
    })

    expect(component.text()).toContain('Generation')
    expect(component.text()).toContain('search_notes')
    expect(component.text()).toContain('Prompt')
    expect(component.text()).toContain('Response')
    expect(component.text()).toContain('Input')
    expect(component.text()).toContain('Output')
  })

  it('uses indigo styling for generations and amber for tool calls', async () => {
    const component = await mountSuspended(TraceTimeline, {
      props: {
        generations: [generation],
        toolCalls: [toolCall],
      },
    })

    const genStep = component.find('[data-step-kind="generation"]')
    const toolStep = component.find('[data-step-kind="tool_call"]')

    expect(genStep.classes()).toContain('bg-white')
    expect(genStep.find('.text-indigo-500').exists()).toBe(true)
    expect(toolStep.find('.text-amber-500').exists()).toBe(true)
  })

  it('shows an expired placeholder for pruned content while keeping metadata', async () => {
    const component = await mountSuspended(TraceTimeline, {
      props: {
        generations: [prunedGeneration],
        toolCalls: [prunedToolCall],
      },
    })

    expect(component.text()).toContain('Content expired')
    expect(component.text()).toContain('anthropic/claude-sonnet-4.5')
    expect(component.text()).toContain('read_note')
  })

  it('collapses and expands a step when clicked', async () => {
    const component = await mountSuspended(TraceTimeline, {
      props: {
        generations: [generation],
        toolCalls: [toolCall],
      },
    })

    const buttons = component.findAll('button')
    const genButton = buttons.find(b => b.text().includes('Generation'))
    expect(genButton).toBeDefined()

    await genButton!.trigger('click')
    expect(component.text()).not.toContain('Prompt')

    await genButton!.trigger('click')
    expect(component.text()).toContain('Prompt')
  })
})
