import type { AgentTool } from '../../server/lib/agent/types'
import type { ChatMessage, CompletionRequest, CompletionResult, EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, describe, expect, vi } from 'vitest'
import { runAgent } from '../../server/lib/agent'
import { clearAgentTestProviders, setAgentTestProviders } from '../../server/lib/agent/providers'
import { halfvecLiteral } from '../../server/lib/agent/vector'

function scriptedLLM(script: ((messages: ChatMessage[]) => CompletionResult)[]): LLMProvider {
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
    usage: { promptTokens: 10, completionTokens: 5, cost: 0.0003 },
  }
}

function stubEmbedding(): EmbeddingProvider {
  return {
    async embed(texts) {
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01) as number[])
    },
  }
}

async function seedNotesDomain(trx: any, workspaceId: string) {
  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/projects/agent.md',
      title: 'Agent Design',
      content: '# Agent Design\n\nThe agent uses tools.',
      content_hash: 'hash-1',
      status: 'ingested',
    })
    .returning(['id', 'path'])
    .executeTakeFirstOrThrow()

  const chunk = await trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 0,
      text: 'The agent uses search_notes to find relevant context.',
      token_count: 10,
      embedding: halfvecLiteral(Array.from({ length: 2048 }, (_, i) => i === 0 ? 1 : 0)),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return { note, chunk }
}

async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body?.getReader()
  if (!reader)
    throw new Error('response has no readable body')

  const decoder = new TextDecoder()
  let buffer = ''
  const events: Array<Record<string, unknown>> = []

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice('data: '.length)
        if (payload)
          events.push(JSON.parse(payload))
      }
    }
  }

  return events
}

describe('llm tracing: chat Answer', () => {
  afterEach(() => {
    clearAgentTestProviders()
    vi.restoreAllMocks()
  })

  test('creates one trace per Answer with generations, tool calls, and messages.trace_id', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotesDomain(trx, workspace.id)

    // Create a large note so read_note output is truncated.
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        path: '/projects/large.md',
        title: 'Large Note',
        content: 'x'.repeat(20_000),
        content_hash: 'hash-large',
        status: 'ingested',
      })
      .execute()

    const llm = scriptedLLM([
      () => toolCallMessage('read_note', { path: '/projects/large.md' }, 'call-1'),
      () => answerMessage('Based on your notes, the agent uses search_notes.'),
    ])

    setAgentTestProviders({ llm, embedding: stubEmbedding() })

    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ query: 'How does the agent find context?' }),
    })

    expect(res.status).toBe(200)
    const events = await readSseEvents(res)
    expect(events.map(e => e.type)).toEqual(['tool_call', 'tool_result', 'answer'])
    const conversationId = (events[events.length - 1] as any).conversationId

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'conversations')
      .where('owner_id', '=', conversationId)
      .executeTakeFirstOrThrow()

    expect(trace.workspace_id).toBe(workspace.id)
    expect(trace.kind).toBe('chat')
    expect(trace.status).toBe('completed')
    expect(trace.error).toBeNull()

    const generations = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .orderBy('seq', 'asc')
      .execute()

    expect(generations).toHaveLength(2)
    expect(generations.map(g => g.seq)).toEqual([0, 2])

    const firstGen = generations[0]!
    expect(firstGen.llm_use_case).toBe('agent')
    expect(firstGen.provider).toBe('openrouter')
    expect(firstGen.model).toBe('test-model')
    expect(firstGen.response).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'call-1', name: 'read_note', arguments: '{"path":"/projects/large.md"}' }],
    })

    const gen = generations[1]!
    expect(gen.llm_use_case).toBe('agent')
    expect(gen.provider).toBe('openrouter')
    expect(gen.model).toBe('test-model')
    expect(gen.prompt).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user' })]))
    expect(gen.response).toEqual({ role: 'assistant', content: 'Based on your notes, the agent uses search_notes.' })
    expect(gen.prompt_tokens).toBe(10)
    expect(gen.completion_tokens).toBe(5)
    expect(gen.cost_usd).toBe('0.000300')
    expect(gen.usage_missing).toBe(false)

    const toolCalls = await trx
      .selectFrom('llm_tool_calls')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .orderBy('seq', 'asc')
      .execute()

    expect(toolCalls).toHaveLength(1)
    const tc = toolCalls[0]!
    expect(tc.seq).toBe(1)
    expect(tc.name).toBe('read_note')
    expect(tc.input).toEqual({ path: '/projects/large.md' })
    expect(tc.status).toBe('completed')
    expect(tc.duration_ms).toBeGreaterThanOrEqual(0)
    expect((tc.output as any).__truncated).toBe(true)
    expect((tc.output as any).__originalBytes).toBeGreaterThan(8192)

    const messages = await trx
      .selectFrom('messages')
      .select(['role', 'content', 'trace_id'])
      .where('conversation_id', '=', conversationId)
      .orderBy('created_at', 'asc')
      .execute()

    const answerRow = messages.find(m => m.role === 'assistant' && m.content === 'Based on your notes, the agent uses search_notes.')
    expect(answerRow).toBeDefined()
    expect(answerRow!.trace_id).toBe(trace.id)
  })

  test('aborts a running trace and keeps partial records', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await seedNotesDomain(trx, workspace.id)

    const controller = new AbortController()
    // Abort during the first (and only) tool execution.
    const slowTool: AgentTool = {
      name: 'slow_tool',
      description: 'a tool that is aborted mid-run',
      parameters: { type: 'object', properties: {} },
      async execute() {
        controller.abort()
        // Give the signal a moment to propagate through the loop.
        await new Promise(r => setTimeout(r, 10))
        return { result: { ok: true }, notes: [] }
      },
    }

    const llm = scriptedLLM([
      () => toolCallMessage('slow_tool', {}, 'call-1'),
      () => answerMessage('should not reach'),
    ])

    const events: Array<Record<string, unknown>> = []
    await runAgent(
      { query: 'Abort me', signal: controller.signal },
      {
        workspaceId: workspace.id,
        db: trx,
        llm,
        embedding: stubEmbedding(),
        llmProviderInfo: { kind: 'openrouter', model: 'test-model' },
      },
      [slowTool],
      e => events.push(e),
    )

    expect(events.some(e => e.type === 'error')).toBe(true)

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'conversations')
      .executeTakeFirstOrThrow()

    expect(trace.kind).toBe('chat')
    expect(trace.status).toBe('aborted')

    const generations = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .execute()

    expect(generations.length).toBeGreaterThanOrEqual(1)

    const toolCalls = await trx
      .selectFrom('llm_tool_calls')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .execute()

    expect(toolCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('tracing failure does not break the chat response', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotesDomain(trx, workspace.id)

    vi.spyOn(await import('../../server/lib/observability/trace-writer'), 'createTrace').mockRejectedValue(new Error('trace db down'))

    const llm = scriptedLLM([() => answerMessage('No trace, no problem.')])
    setAgentTestProviders({ llm, embedding: stubEmbedding() })

    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ query: 'Trace failure test' }),
    })

    expect(res.status).toBe(200)
    const events = await readSseEvents(res)
    expect(events.some(e => e.type === 'answer')).toBe(true)
    expect((events.find(e => e.type === 'answer') as any).text).toBe('No trace, no problem.')

    const traces = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('kind', '=', 'chat')
      .execute()

    expect(traces).toHaveLength(0)
  })
})
