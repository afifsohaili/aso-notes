import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { LLMProvider } from '../../server/lib/ai/types'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { resolveEmbeddingProvider, resolveLLMProvider } from '../../server/lib/ai/registry'
import { createTrace } from '../../server/lib/observability/trace-writer'

function mockFetch(body: unknown): typeof fetch {
  return async (_url, _init) => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function givenTrace(trx: Kysely<Database>, workspaceId: string): Promise<string> {
  const conversation = await trx
    .insertInto('conversations')
    .values({ workspace_id: workspaceId, title: 'Trace integration test' })
    .returning('id')
    .executeTakeFirstOrThrow()

  return createTrace(trx, {
    workspaceId,
    kind: 'chat',
    ownerType: 'conversations',
    ownerId: conversation.id,
  })
}

describe('llm tracing instrumentation (Phase 2)', () => {
  test('resolveLLMProvider returns a plain provider without trace context', () => {
    const resolved = resolveLLMProvider('agent', {
      NUXT_LLM_AGENT_API_KEY: 'sk-test',
    })

    expect(resolved.provider).toBeDefined()
    expect((resolved.provider as LLMProvider).complete).toBeInstanceOf(Function)
    // No traced wrapper means no stream/traced-only methods visible.
    expect((resolved.provider as any).completeStream).toBeUndefined()
  })

  test('resolveLLMProvider with trace context writes a generation row', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const traceId = await givenTrace(trx, workspace.id)

    const fetchFn = mockFetch({
      choices: [{
        message: {
          role: 'assistant',
          content: 'integration answer',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 7, completion_tokens: 4, cost: 0.0003 },
    })

    const resolved = resolveLLMProvider(
      'agent',
      { NUXT_LLM_AGENT_API_KEY: 'sk-test' },
      {},
      { fetchFn },
      { db: trx },
    )

    const result = await resolved.provider.complete(
      { messages: [{ role: 'user', content: 'hello from integration test' }] },
      { traceId, workspaceId: workspace.id, useCase: 'agent', seq: 1 },
    )

    expect(result.message.content).toBe('integration answer')

    // Allow the fire-and-forget trace write to settle.
    await new Promise(r => setTimeout(r, 50))

    const rows = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', traceId)
      .execute()

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.workspace_id).toBe(workspace.id)
    expect(row.seq).toBe(1)
    expect(row.llm_use_case).toBe('agent')
    expect(row.provider).toBe('openrouter')
    expect(row.model).toBeDefined()
    expect(row.prompt).toEqual([{ role: 'user', content: 'hello from integration test' }])
    expect(row.response).toEqual({ role: 'assistant', content: 'integration answer' })
    expect(row.prompt_tokens).toBe(7)
    expect(row.completion_tokens).toBe(4)
    expect(row.cost_usd).toBe('0.000300')
    expect(row.latency_ms).toBeGreaterThanOrEqual(0)
    expect(row.finish_reason).toBe('stop')
    expect(row.usage_missing).toBe(false)
    expect(row.error).toBeNull()
  })

  test('resolveLLMProvider with trace context records missing usage flag', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const traceId = await givenTrace(trx, workspace.id)

    const fetchFn = mockFetch({
      choices: [{ message: { role: 'assistant', content: 'no usage' } }],
    })

    const resolved = resolveLLMProvider(
      'extraction',
      { NUXT_LLM_EXTRACTION_API_KEY: 'sk-test' },
      {},
      { fetchFn },
      { db: trx },
    )

    await resolved.provider.complete(
      { messages: [{ role: 'user', content: 'extract' }] },
      { traceId, workspaceId: workspace.id, useCase: 'extraction', seq: 1 },
    )

    await new Promise(r => setTimeout(r, 50))

    const row = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', traceId)
      .executeTakeFirstOrThrow()

    expect(row.prompt_tokens).toBeNull()
    expect(row.completion_tokens).toBeNull()
    expect(row.cost_usd).toBeNull()
    expect(row.usage_missing).toBe(true)
  })

  test('resolveEmbeddingProvider with trace context writes metadata-only row', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const traceId = await givenTrace(trx, workspace.id)

    const fetchFn = mockFetch({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 3, total_tokens: 3, cost: 0.0001 },
    })

    const resolved = resolveEmbeddingProvider(
      { NUXT_LLM_EMBEDDING_API_KEY: 'sk-test' },
      {},
      { fetchFn },
      { db: trx },
    )

    await resolved.provider.embed(
      ['trace me'],
      { traceId, workspaceId: workspace.id, useCase: 'embedding', seq: 1 },
    )

    await new Promise(r => setTimeout(r, 50))

    const row = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', traceId)
      .executeTakeFirstOrThrow()

    expect(row.llm_use_case).toBe('embedding')
    expect(row.prompt).toBeNull()
    expect(row.response).toBeNull()
    expect(row.prompt_tokens).toBe(3)
    expect(row.completion_tokens).toBe(3)
    expect(row.cost_usd).toBe('0.000100')
    expect(row.usage_missing).toBe(false)
  })
})
