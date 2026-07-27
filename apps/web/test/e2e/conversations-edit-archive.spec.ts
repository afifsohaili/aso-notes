import type { EmbeddingProvider, LLMProvider } from '../../server/lib/agent/types'
import type { ChatMessage, CompletionRequest, CompletionResult } from '../../server/lib/ai/types'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, describe, expect } from 'vitest'
import { clearAgentTestProviders, setAgentTestProviders } from '../../server/lib/agent/providers'

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
        try {
          events.push(JSON.parse(line.slice(6)))
        }
        catch { /* ignore malformed */ }
      }
    }
  }
  return events
}

async function seedConversation(trx: any, workspaceId: string) {
  const conversation = await trx
    .insertInto('conversations')
    .values({ workspace_id: workspaceId, title: 'seeded' })
    .returning('id')
    .executeTakeFirstOrThrow()

  const base = new Date('2026-01-01T00:00:00Z').getTime()
  const insertMessage = (role: string, content: string, offsetSec: number) =>
    trx
      .insertInto('messages')
      .values({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        role,
        content,
        tool_calls: null,
        tool_call_id: null,
        created_at: new Date(base + offsetSec * 1000),
      })
      .returning('id')
      .executeTakeFirstOrThrow()

  const m1 = await insertMessage('user', 'first question', 1)
  const m2 = await insertMessage('assistant', 'first answer', 2)
  const m3 = await insertMessage('user', 'second question', 3)
  const m4 = await insertMessage('assistant', 'second answer', 4)

  return { conversation, m1, m2, m3, m4 }
}

async function postQuery(
  server: (path: string, init?: RequestInit) => Promise<Response>,
  cookies: string,
  body: Record<string, unknown>,
) {
  return server('/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': cookies },
    body: JSON.stringify(body),
  })
}

describe('edit previous message (truncation)', () => {
  afterEach(() => {
    clearAgentTestProviders()
  })

  test('deletes the edited message and everything after it, then appends the new turn', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { conversation, m1, m2, m3, m4 } = await seedConversation(trx, workspace.id)

    setAgentTestProviders({
      llm: scriptedLLM([() => answerMessage('replacement answer')]),
      embedding: stubEmbedding(),
    })

    const res = await postQuery(server, cookies, {
      query: 'edited second question',
      conversationId: conversation.id,
      editFromMessageId: m3.id,
    })
    expect(res.status).toBe(200)
    const events = await readSseEvents(res)
    expect(events.some(e => e.type === 'answer')).toBe(true)

    const remaining = await trx
      .selectFrom('messages')
      .select(['id', 'role', 'content'])
      .where('conversation_id', '=', conversation.id)
      .orderBy('created_at', 'asc')
      .execute()

    expect(remaining.map((m: any) => m.content)).toEqual([
      'first question',
      'first answer',
      'edited second question',
      'replacement answer',
    ])
    expect(remaining.map((m: any) => m.id)).toContain(m1.id)
    expect(remaining.map((m: any) => m.id)).toContain(m2.id)
    expect(remaining.map((m: any) => m.id)).not.toContain(m3.id)
    expect(remaining.map((m: any) => m.id)).not.toContain(m4.id)
  })

  test('returns an error event when the message belongs to another conversation', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { conversation } = await seedConversation(trx, workspace.id)
    const other = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'other' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const foreign = await trx
      .insertInto('messages')
      .values({
        workspace_id: workspace.id,
        conversation_id: other.id,
        role: 'user',
        content: 'foreign',
        tool_calls: null,
        tool_call_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    setAgentTestProviders({
      llm: scriptedLLM([() => answerMessage('should not run')]),
      embedding: stubEmbedding(),
    })

    const res = await postQuery(server, cookies, {
      query: 'edit attempt',
      conversationId: conversation.id,
      editFromMessageId: foreign.id,
    })
    const events = await readSseEvents(res)
    expect(events.some(e => e.type === 'error')).toBe(true)

    const remaining = await trx
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', conversation.id)
      .execute()
    expect(remaining).toHaveLength(4)
  })
})

describe('archive conversation', () => {
  test('archived conversations are hidden from the default list and restorable', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { conversation } = await seedConversation(trx, workspace.id)

    // archive it
    const archiveRes = await server(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)

    // default list excludes archived
    const listRes = await server('/api/conversations', {
      headers: { cookie: cookies },
    })
    const list = await listRes.json()
    expect(list.map((c: any) => c.id)).not.toContain(conversation.id)

    // archived list shows it
    const archivedRes = await server('/api/conversations?archived=true', {
      headers: { cookie: cookies },
    })
    const archived = await archivedRes.json()
    expect(archived.map((c: any) => c.id)).toContain(conversation.id)

    // restore
    const restoreRes = await server(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)

    const listRes2 = await server('/api/conversations', {
      headers: { cookie: cookies },
    })
    const list2 = await listRes2.json()
    expect(list2.map((c: any) => c.id)).toContain(conversation.id)
  })

  test('PATCH requires auth', async ({ server }) => {
    const res = await server('/api/conversations/whatever', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    expect(res.status).toBe(401)
  })
})
