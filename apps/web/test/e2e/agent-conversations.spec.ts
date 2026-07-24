import type { EmbeddingProvider, LLMProvider } from '../../server/lib/agent/types'
import type { ChatMessage, CompletionRequest, CompletionResult } from '../../server/lib/ai/types'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, describe, expect } from 'vitest'
import { clearAgentTestProviders, setAgentTestProviders } from '../../server/lib/agent/providers'
import { halfvecLiteral } from '../../server/lib/agent/vector'

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

  const concept = await trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Agent Tool',
      name_normalized: 'agent tool',
      description: 'A tool the agent can call',
      embedding: halfvecLiteral(Array.from({ length: 2048 }, (_, i) => i === 0 ? 1 : 0)),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk.id, concept_id: concept.id })
    .execute()

  return { note, chunk, concept }
}

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

function stubEmbedding(): EmbeddingProvider {
  return {
    async embed(texts) {
      return texts.map(() => Array.from({ length: 2048 }, (_, i) => i === 0 ? 1 : 0))
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

describe('pOST /api/conversations', () => {
  afterEach(() => {
    clearAgentTestProviders()
  })

  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  test('streams tool_call, tool_result, answer events and persists messages', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { note } = await seedNotesDomain(trx, workspace.id)

    const llm = scriptedLLM([
      () => toolCallMessage('search_notes', { query: 'agent tools', limit: 5 }, 'call-1'),
      () => answerMessage('Based on your notes, the agent uses search_notes.'),
    ])

    setAgentTestProviders({ llm, embedding: stubEmbedding() })

    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ query: 'How does the agent find context?' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const events = await readSseEvents(res)
    expect(events.map(e => e.type)).toEqual(['tool_call', 'tool_result', 'answer'])

    expect(events[0]).toMatchObject({ type: 'tool_call', name: 'search_notes', args: { query: 'agent tools', limit: 5 }, toolCallId: 'call-1' })
    expect(events[1]).toMatchObject({ type: 'tool_result', name: 'search_notes', toolCallId: 'call-1' })
    expect((events[1] as any).result.notes.map((n: any) => n.path)).toContain(note.path)
    expect(events[2]).toMatchObject({ type: 'answer', text: 'Based on your notes, the agent uses search_notes.' })
    expect((events[2] as any).notes).toContain(note.path)

    const conversationId = (events[2] as any).conversationId
    expect(conversationId).toBeTruthy()

    const messages = await trx
      .selectFrom('messages')
      .select(['role', 'content', 'tool_calls', 'tool_call_id'])
      .where('conversation_id', '=', conversationId)
      .orderBy('created_at', 'asc')
      .execute()

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(messages[0].content).toBe('How does the agent find context?')
    expect(messages[1].tool_calls).toBeTruthy()
    expect(messages[1].tool_call_id).toBeNull()
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call-1')
    expect(messages[3].content).toBe('Based on your notes, the agent uses search_notes.')
  })

  test('stops at 10 tool iterations and emits a wrap-up answer', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotesDomain(trx, workspace.id)

    const script: ((messages: ChatMessage[]) => CompletionResult)[] = []
    for (let i = 0; i < 10; i++) {
      script.push(() => toolCallMessage('search_notes', { query: `q${i}` }, `call-${i}`))
    }
    script.push(() => answerMessage('Wrap-up answer'))

    setAgentTestProviders({ llm: scriptedLLM(script), embedding: stubEmbedding() })

    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ query: 'Loop' }),
    })

    const events = await readSseEvents(res)
    expect(events.filter(e => e.type === 'tool_call').length).toBe(10)
    expect(events.filter(e => e.type === 'tool_result').length).toBe(10)
    expect(events[events.length - 1]).toMatchObject({ type: 'answer', text: 'Wrap-up answer' })
  })

  test('continues an existing conversation and includes prior messages in context', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotesDomain(trx, workspace.id)

    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Existing' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('messages')
      .values({
        workspace_id: workspace.id,
        conversation_id: conversation.id,
        role: 'user',
        content: 'First question',
        tool_calls: null,
        tool_call_id: null,
      })
      .execute()

    const script: ((messages: ChatMessage[]) => CompletionResult)[] = []
    script.push((messages) => {
      expect(messages.some(m => m.role === 'user' && m.content === 'First question')).toBe(true)
      return toolCallMessage('search_notes', { query: 'follow-up' }, 'follow-up-1')
    })
    script.push(() => answerMessage('Follow-up answer'))

    setAgentTestProviders({ llm: scriptedLLM(script), embedding: stubEmbedding() })

    const res = await server('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ query: 'Second question', conversationId: conversation.id }),
    })

    const events = await readSseEvents(res)
    expect(events[events.length - 1]).toMatchObject({ type: 'answer', text: 'Follow-up answer' })
  })
})

describe('gET /api/conversations', () => {
  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/conversations')
    expect(res.status).toBe(401)
  })

  test('lists conversations for the workspace', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('conversations')
      .values({
        workspace_id: workspace.id,
        title: 'Chat A',
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .execute()
    await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Chat B' })
      .execute()

    const res = await server('/api/conversations', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].title).toBe('Chat B')
    expect(body[1].title).toBe('Chat A')
  })
})

describe('gET /api/conversations/:id', () => {
  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/conversations/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(401)
  })

  test('returns conversation with messages', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Chat' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('messages')
      .values({
        workspace_id: workspace.id,
        conversation_id: conversation.id,
        role: 'user',
        content: 'Hello',
        tool_calls: null,
        tool_call_id: null,
      })
      .execute()

    const res = await server(`/api/conversations/${conversation.id}`, { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(conversation.id)
    expect(body.title).toBe('Chat')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toBe('Hello')
  })

  test('returns 404 for a conversation outside the workspace', async ({ server, trx }) => {
    const { cookies } = await givenVerifiedUser()
    const otherWorkspace = await trx
      .insertInto('workspaces')
      .values({ name: 'Other' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: otherWorkspace.id, title: 'Private' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const res = await server(`/api/conversations/${conversation.id}`, { headers: { cookie: cookies } })
    expect(res.status).toBe(404)
  })
})
