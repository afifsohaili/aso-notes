import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

async function seedTrace(trx: any, workspaceId: string) {
  const startedAt = new Date('2026-08-10T09:00:00.000Z')
  const finishedAt = new Date('2026-08-10T09:00:02.500Z')

  const [trace] = await trx
    .insertInto('llm_traces')
    .values({
      workspace_id: workspaceId,
      kind: 'chat',
      owner_type: 'conversations',
      owner_id: '00000000-0000-0000-0000-000000000001',
      status: 'completed',
      started_at: startedAt,
      finished_at: finishedAt,
      error: null,
    })
    .returning(['id', 'started_at', 'finished_at'])
    .execute()

  await trx
    .insertInto('llm_generations')
    .values([
      {
        workspace_id: workspaceId,
        trace_id: trace.id,
        seq: 1,
        llm_use_case: 'agent',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.5',
        prompt: JSON.stringify([{ role: 'user', content: 'Hello' }]),
        response: JSON.stringify({ role: 'assistant', content: 'Hi' }),
        prompt_tokens: 10,
        completion_tokens: 20,
        cost_usd: '0.000123',
        latency_ms: 800,
        finish_reason: 'stop',
        error: null,
        usage_missing: false,
      },
      {
        workspace_id: workspaceId,
        trace_id: trace.id,
        seq: 3,
        llm_use_case: 'agent',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.5',
        prompt: null,
        response: null,
        prompt_tokens: 5,
        completion_tokens: 15,
        cost_usd: '0.000456',
        latency_ms: 1200,
        finish_reason: 'tool_calls',
        error: null,
        usage_missing: false,
        pruned_at: new Date('2026-08-11T09:00:00.000Z'),
      },
    ])
    .execute()

  await trx
    .insertInto('llm_tool_calls')
    .values([
      {
        workspace_id: workspaceId,
        trace_id: trace.id,
        seq: 0,
        name: 'search_notes',
        input: JSON.stringify({ query: 'hello' }),
        output: JSON.stringify({ results: [] }),
        duration_ms: 210,
        status: 'completed',
      },
      {
        workspace_id: workspaceId,
        trace_id: trace.id,
        seq: 2,
        name: 'read_note',
        input: JSON.stringify({ path: '/a.md' }),
        output: null,
        duration_ms: 88,
        status: 'completed',
        pruned_at: new Date('2026-08-11T09:00:00.000Z'),
      },
    ])
    .execute()

  return { traceId: trace.id, startedAt, finishedAt }
}

describe('get /api/traces/:id', () => {
  test('returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/traces/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(401)
  })

  test('returns 404 for a trace owned by another workspace', async ({ server, trx }) => {
    const { workspace } = await givenVerifiedUser()
    const { traceId } = await seedTrace(trx, workspace.id)

    const other = await givenVerifiedUser()

    const res = await server(`/api/traces/${traceId}`, {
      headers: { cookie: other.cookies },
    })

    expect(res.status).toBe(404)
  })

  test('returns the trace with generations and tool calls sorted by seq and content nulled after prune', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { traceId, startedAt, finishedAt } = await seedTrace(trx, workspace.id)

    const res = await server(`/api/traces/${traceId}`, {
      headers: { cookie: cookies },
    })

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.trace.id).toBe(traceId)
    expect(body.trace.kind).toBe('chat')
    expect(body.trace.status).toBe('completed')
    expect(body.trace.ownerType).toBe('conversations')
    expect(body.trace.startedAt).toBe(startedAt.toISOString())
    expect(body.trace.finishedAt).toBe(finishedAt.toISOString())
    expect(body.trace.error).toBeNull()

    expect(body.generations).toHaveLength(2)
    expect(body.generations.map((g: any) => g.seq)).toEqual([1, 3])
    expect(body.generations[0]).toMatchObject({
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
      usageMissing: false,
      prunedAt: null,
    })

    const prunedGen = body.generations[1]
    expect(prunedGen.seq).toBe(3)
    expect(prunedGen.prompt).toBeNull()
    expect(prunedGen.response).toBeNull()
    expect(prunedGen.prunedAt).toBeTruthy()

    expect(body.toolCalls).toHaveLength(2)
    expect(body.toolCalls.map((t: any) => t.seq)).toEqual([0, 2])
    expect(body.toolCalls[0]).toMatchObject({
      seq: 0,
      name: 'search_notes',
      input: { query: 'hello' },
      output: { results: [] },
      durationMs: 210,
      status: 'completed',
      prunedAt: null,
    })

    const prunedTool = body.toolCalls[1]
    expect(prunedTool.seq).toBe(2)
    expect(prunedTool.name).toBe('read_note')
    expect(prunedTool.output).toBeNull()
    expect(prunedTool.prunedAt).toBeTruthy()

    expect(body.totalTokens).toBe(50)
    expect(body.totalCost).toBe('0.000579')
    expect(body.durationMs).toBe(2500)
  })
})
