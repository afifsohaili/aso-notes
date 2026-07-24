import type { AgentContext, AgentTool, LLMProvider } from '../../server/lib/agent/types'
import type { ChatMessage, CompletionRequest, CompletionResult } from '../../server/lib/ai/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { MAX_AGENT_ITERATIONS, runAgentLoop } from '../../server/lib/agent/loop'

function stubTool(name: string, result: unknown, notes: string[] = []): AgentTool {
  return {
    name,
    description: `stub ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { result, notes }
    },
  }
}

function scriptedLLM(
  script: ((messages: ChatMessage[]) => CompletionResult)[],
): LLMProvider {
  let index = 0
  return {
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const fn = script[index]
      if (!fn)
        throw new Error(`LLM script exhausted at call ${index}`)
      index++
      return fn(request.messages)
    },
  }
}

function toolCallMessage(name: string, args: object, id: string): CompletionResult {
  return {
    message: {
      role: 'assistant',
      content: null,
      toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    },
  }
}

function answerMessage(text: string): CompletionResult {
  return {
    message: { role: 'assistant', content: text },
  }
}

function stubContext(): AgentContext {
  return {
    workspaceId: 'workspace-1',
    db: {} as any,
    llm: { async complete() { throw new Error('llm not set') } },
    embedding: { async embed() { return [[0]] } },
  }
}

describe('agent loop', () => {
  test('executes a tool call and emits the final answer', async () => {
    const events: any[] = []
    const llm = scriptedLLM([
      () => toolCallMessage('echo', { value: 'hello' }, 'call-1'),
      () => answerMessage('Done'),
    ])
    const ctx = { ...stubContext(), llm }

    const result = await runAgentLoop(
      [{ role: 'user', content: 'Say hello' }],
      [stubTool('echo', { echoed: 'hello' }, ['/notes/hello.md'])],
      ctx,
      e => events.push(e),
    )

    expect(events.map(e => e.type)).toEqual(['tool_call', 'tool_result', 'answer'])
    expect(events[0]).toEqual({ type: 'tool_call', name: 'echo', args: { value: 'hello' }, toolCallId: 'call-1' })
    expect(events[1]).toEqual({ type: 'tool_result', name: 'echo', result: { echoed: 'hello' }, toolCallId: 'call-1' })
    expect(events[2]).toEqual({ type: 'answer', text: 'Done', notes: ['/notes/hello.md'] })
    expect(result.answer).toBe('Done')
    expect(result.notes).toEqual(['/notes/hello.md'])
  })

  test('stops at MAX_AGENT_ITERATIONS and invokes wrap-up completion', async () => {
    const events: any[] = []
    const calls: LLMProvider['complete'][] = []
    for (let i = 0; i < MAX_AGENT_ITERATIONS; i++)
      calls.push(() => toolCallMessage('noop', {}, `call-${i}`))
    calls.push(() => answerMessage('Wrap-up answer'))

    const llm = scriptedLLM(calls.map(fn => (messages: ChatMessage[]) => fn({ messages, tools: [] } as any)))
    const ctx = { ...stubContext(), llm }

    const result = await runAgentLoop(
      [{ role: 'user', content: 'Loop forever' }],
      [stubTool('noop', {}, [])],
      ctx,
      e => events.push(e),
    )

    expect(events.filter(e => e.type === 'tool_call').length).toBe(MAX_AGENT_ITERATIONS)
    expect(events.filter(e => e.type === 'tool_result').length).toBe(MAX_AGENT_ITERATIONS)
    expect(events[events.length - 1]).toEqual({ type: 'answer', text: 'Wrap-up answer', notes: [] })
    expect(result.answer).toBe('Wrap-up answer')
  })

  test('feeds invalid JSON args back to the LLM as a tool error', async () => {
    const events: any[] = []
    const llm = scriptedLLM([
      () => ({
        message: {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'bad', name: 'echo', arguments: 'not-json' }],
        },
      }),
      (messages) => {
        const last = messages[messages.length - 1]
        expect(last?.role).toBe('tool')
        return answerMessage('Recovered')
      },
    ])
    const ctx = { ...stubContext(), llm }

    await runAgentLoop([{ role: 'user', content: 'Test' }], [stubTool('echo', {}, [])], ctx, e => events.push(e))

    expect(events[0]).toEqual({ type: 'tool_call', name: 'echo', args: { raw: 'not-json' }, toolCallId: 'bad' })
    expect((events[1] as any).result.error).toContain('Invalid JSON')
    expect(events[2].type).toBe('answer')
  })

  test('handles unknown tool names gracefully', async () => {
    const events: any[] = []
    const llm = scriptedLLM([
      () => toolCallMessage('does_not_exist', {}, 'unknown-1'),
      () => answerMessage('Acknowledged'),
    ])
    const ctx = { ...stubContext(), llm }

    await runAgentLoop([{ role: 'user', content: 'Test' }], [stubTool('echo', {}, [])], ctx, e => events.push(e))

    expect((events[1] as any).result.error).toContain('Unknown tool')
    expect(events[2]).toEqual({ type: 'answer', text: 'Acknowledged', notes: [] })
  })

  test('emits an error event when the LLM throws', async () => {
    const events: any[] = []
    const llm: LLMProvider = {
      async complete() {
        throw new Error('model unavailable')
      },
    }
    const ctx = { ...stubContext(), llm }

    const result = await runAgentLoop([{ role: 'user', content: 'Test' }], [], ctx, e => events.push(e))

    expect(events).toEqual([{ type: 'error', message: 'model unavailable' }])
    expect(result.answer).toBe('')
    expect(result.notes).toEqual([])
  })
})
