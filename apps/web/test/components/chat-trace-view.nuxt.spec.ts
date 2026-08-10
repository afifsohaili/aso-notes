import type { TraceResponse } from '../../app/components/chat/chat-trace-view.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ChatTraceView from '../../app/components/chat/chat-trace-view.vue'

const baseTrace: TraceResponse = {
  trace: {
    id: 't1',
    kind: 'chat',
    status: 'completed',
    ownerType: 'conversations',
    ownerId: 'conv-1',
    startedAt: '2026-08-10T09:00:00.000Z',
    finishedAt: '2026-08-10T09:00:02.500Z',
    error: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:02.500Z',
  },
  generations: [
    {
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
    },
  ],
  toolCalls: [
    {
      id: 'tc-1',
      seq: 0,
      name: 'search_notes',
      input: { query: 'graph rag' },
      output: { results: [{ path: '/a.md' }] },
      durationMs: 210,
      status: 'completed',
      prunedAt: null,
      createdAt: '2026-08-10T09:00:00.000Z',
    },
  ],
  totalTokens: 30,
  totalCost: '0.000123',
  durationMs: 2500,
}

describe('chat-trace-view', () => {
  it('renders the header, totals, and steps expanded by default', async () => {
    const component = await mountSuspended(ChatTraceView, {
      props: { trace: baseTrace },
    })

    expect(component.text()).toContain('Trace')
    expect(component.text()).toContain('completed')
    expect(component.text()).toContain('30')
    expect(component.text()).toContain('$0.0001')
    expect(component.text()).toContain('Prompt')
    expect(component.text()).toContain('Output')
  })

  it('distinguishes generation and tool-call styling', async () => {
    const component = await mountSuspended(ChatTraceView, {
      props: { trace: baseTrace },
    })

    const genStep = component.find('[data-step-kind="generation"]')
    const toolStep = component.find('[data-step-kind="tool_call"]')

    expect(genStep.find('.text-indigo-500').exists()).toBe(true)
    expect(toolStep.find('.text-amber-500').exists()).toBe(true)
  })

  it('shows an expired placeholder for pruned content while keeping metadata', async () => {
    const trace: TraceResponse = {
      ...baseTrace,
      generations: [
        {
          ...baseTrace.generations[0]!,
          id: 'g-2',
          seq: 2,
          prompt: null,
          response: null,
          prunedAt: '2026-08-11T09:00:00.000Z',
        },
      ],
      toolCalls: [
        {
          ...baseTrace.toolCalls[0]!,
          id: 'tc-2',
          seq: 2,
          name: 'read_note',
          output: null,
          prunedAt: '2026-08-11T09:00:00.000Z',
        },
      ],
    }

    const component = await mountSuspended(ChatTraceView, {
      props: { trace },
    })

    expect(component.text()).toContain('Content expired')
    expect(component.text()).toContain('anthropic/claude-sonnet-4.5')
    expect(component.text()).toContain('read_note')
  })

  it('shows an error message when the trace is missing', async () => {
    const component = await mountSuspended(ChatTraceView, {
      props: { trace: null },
    })

    expect(component.text()).toContain('Could not load trace')
  })
})
