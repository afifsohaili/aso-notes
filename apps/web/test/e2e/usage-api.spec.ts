import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

async function seedTrace(trx: any, workspaceId: string) {
  const [trace] = await trx
    .insertInto('llm_traces')
    .values({
      workspace_id: workspaceId,
      kind: 'chat',
      owner_type: 'conversations',
      owner_id: '00000000-0000-0000-0000-000000000001',
      status: 'completed',
      started_at: new Date(),
      finished_at: new Date(),
      error: null,
    })
    .returning(['id'])
    .execute()
  return trace.id as string
}

async function seedUsage(trx: any, workspaceId: string) {
  const now = new Date()

  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setUTCDate(now.getUTCDate() - 1)
  const sixDaysAgo = new Date(now)
  sixDaysAgo.setUTCDate(now.getUTCDate() - 6)
  const twentyNineDaysAgo = new Date(now)
  twentyNineDaysAgo.setUTCDate(now.getUTCDate() - 29)
  const thirtyOneDaysAgo = new Date(now)
  thirtyOneDaysAgo.setUTCDate(now.getUTCDate() - 31)

  const traceId = await seedTrace(trx, workspaceId)

  await trx
    .insertInto('llm_generations')
    .values([
      // Today: 1 generation, 30 tokens, $0.000300
      {
        workspace_id: workspaceId,
        trace_id: traceId,
        seq: 0,
        llm_use_case: 'agent',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.5',
        prompt: null,
        response: null,
        prompt_tokens: 10,
        completion_tokens: 20,
        cost_usd: '0.000300',
        latency_ms: 100,
        finish_reason: 'stop',
        error: null,
        usage_missing: false,
        created_at: today,
      },
      // Yesterday: 1 generation, 40 tokens, $0.000400, extraction
      {
        workspace_id: workspaceId,
        trace_id: traceId,
        seq: 1,
        llm_use_case: 'extraction',
        provider: 'openrouter',
        model: 'openai/gpt-4.1-mini',
        prompt: null,
        response: null,
        prompt_tokens: 15,
        completion_tokens: 25,
        cost_usd: '0.000400',
        latency_ms: 100,
        finish_reason: 'stop',
        error: null,
        usage_missing: false,
        created_at: yesterday,
      },
      // 8 days ago: 1 generation, usage missing, should be counted but not cost/tokens
      {
        workspace_id: workspaceId,
        trace_id: traceId,
        seq: 2,
        llm_use_case: 'agent',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.5',
        prompt: null,
        response: null,
        prompt_tokens: null,
        completion_tokens: null,
        cost_usd: null,
        latency_ms: 100,
        finish_reason: null,
        error: null,
        usage_missing: true,
        created_at: sixDaysAgo,
      },
      // 29 days ago: 1 generation, 50 tokens, $0.000500, embedding
      {
        workspace_id: workspaceId,
        trace_id: traceId,
        seq: 3,
        llm_use_case: 'embedding',
        provider: 'openrouter',
        model: 'openai/text-embedding-3-large',
        prompt: null,
        response: null,
        prompt_tokens: 20,
        completion_tokens: 30,
        cost_usd: '0.000500',
        latency_ms: 100,
        finish_reason: 'stop',
        error: null,
        usage_missing: false,
        created_at: twentyNineDaysAgo,
      },
      // 31 days ago: outside all windows, should be excluded
      {
        workspace_id: workspaceId,
        trace_id: traceId,
        seq: 4,
        llm_use_case: 'consolidation',
        provider: 'openrouter',
        model: 'openai/gpt-4.1-mini',
        prompt: null,
        response: null,
        prompt_tokens: 100,
        completion_tokens: 100,
        cost_usd: '0.001000',
        latency_ms: 100,
        finish_reason: 'stop',
        error: null,
        usage_missing: false,
        created_at: thirtyOneDaysAgo,
      },
    ])
    .execute()
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

describe('get /api/usage', () => {
  test('returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/usage')
    expect(res.status).toBe(401)
  })

  test('returns an empty summary when no generations exist', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const res = await server('/api/usage', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ranges.today).toEqual({
      generations: 0,
      tokens: 0,
      costUsd: '0.000000',
      usageMissingGenerations: 0,
    })
    expect(body.ranges.last7d).toEqual(body.ranges.today)
    expect(body.ranges.last30d).toEqual(body.ranges.today)
    expect(body.groups).toEqual([])
    expect(body.daily).toEqual([])
    expect(body.total).toEqual({
      generations: 0,
      tokens: 0,
      costUsd: '0.000000',
      usageMissingGenerations: 0,
    })
  })

  test('returns correct time-window rollups and excludes another workspace', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedUsage(trx, workspace.id)

    const other = await givenVerifiedUser()
    await seedUsage(trx, other.workspace.id)

    const now = new Date()
    const today = new Date(now)
    const yesterday = new Date(now)
    yesterday.setUTCDate(now.getUTCDate() - 1)
    const sixDaysAgo = new Date(now)
    sixDaysAgo.setUTCDate(now.getUTCDate() - 6)
    const twentyNineDaysAgo = new Date(now)
    twentyNineDaysAgo.setUTCDate(now.getUTCDate() - 29)

    const res = await server('/api/usage', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    // today: 1 generation, 30 tokens, $0.000300
    expect(body.ranges.today).toEqual({
      generations: 1,
      tokens: 30,
      costUsd: '0.000300',
      usageMissingGenerations: 0,
    })
    // 7d: today + yesterday + missing = 3 generations, 30+40 tokens = 70, $0.000700
    expect(body.ranges.last7d).toEqual({
      generations: 3,
      tokens: 70,
      costUsd: '0.000700',
      usageMissingGenerations: 1,
    })
    // 30d: 4 generations (excluding 31 days ago), 30+40+50 = 120 tokens, $0.001200
    expect(body.ranges.last30d).toEqual({
      generations: 4,
      tokens: 120,
      costUsd: '0.001200',
      usageMissingGenerations: 1,
    })

    expect(body.groups).toHaveLength(3)
    expect(body.groups).toContainEqual({
      useCase: 'agent',
      model: 'anthropic/claude-sonnet-4.5',
      generations: 2,
      tokens: 30,
      costUsd: '0.000300',
      usageMissingGenerations: 1,
    })
    expect(body.groups).toContainEqual({
      useCase: 'extraction',
      model: 'openai/gpt-4.1-mini',
      generations: 1,
      tokens: 40,
      costUsd: '0.000400',
      usageMissingGenerations: 0,
    })
    expect(body.groups).toContainEqual({
      useCase: 'embedding',
      model: 'openai/text-embedding-3-large',
      generations: 1,
      tokens: 50,
      costUsd: '0.000500',
      usageMissingGenerations: 0,
    })

    expect(body.total).toEqual({
      generations: 4,
      tokens: 120,
      costUsd: '0.001200',
      usageMissingGenerations: 1,
    })

    expect(body.daily).toHaveLength(4)
    expect(body.daily).toContainEqual({
      day: isoDay(today),
      generations: 1,
      tokens: 30,
      costUsd: '0.000300',
      usageMissingGenerations: 0,
    })
    expect(body.daily).toContainEqual({
      day: isoDay(yesterday),
      generations: 1,
      tokens: 40,
      costUsd: '0.000400',
      usageMissingGenerations: 0,
    })
    expect(body.daily).toContainEqual({
      day: isoDay(sixDaysAgo),
      generations: 1,
      tokens: 0,
      costUsd: '0.000000',
      usageMissingGenerations: 1,
    })
    expect(body.daily).toContainEqual({
      day: isoDay(twentyNineDaysAgo),
      generations: 1,
      tokens: 50,
      costUsd: '0.000500',
      usageMissingGenerations: 0,
    })
  })

  test('is isolated from another workspace', async ({ server, trx }) => {
    const { workspace } = await givenVerifiedUser()
    await seedUsage(trx, workspace.id)

    const other = await givenVerifiedUser()

    const res = await server('/api/usage', { headers: { cookie: other.cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ranges.last30d).toEqual({
      generations: 0,
      tokens: 0,
      costUsd: '0.000000',
      usageMissingGenerations: 0,
    })
    expect(body.groups).toEqual([])
  })
})
