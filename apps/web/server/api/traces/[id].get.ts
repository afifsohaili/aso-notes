import { useDatabase } from '~~/utils/db'
import { resolveWorkspaceId } from '../../utils/workspace'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Trace not found' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Trace not found' })
  }

  const trace = await db
    .selectFrom('llm_traces')
    .select([
      'id',
      'kind',
      'status',
      'owner_type',
      'owner_id',
      'started_at',
      'finished_at',
      'error',
      'created_at',
      'updated_at',
    ])
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()

  if (!trace) {
    throw createError({ statusCode: 404, statusMessage: 'Trace not found' })
  }

  const [generations, toolCalls] = await Promise.all([
    db
      .selectFrom('llm_generations')
      .select([
        'id',
        'seq',
        'llm_use_case',
        'provider',
        'model',
        'prompt',
        'response',
        'prompt_tokens',
        'completion_tokens',
        'cost_usd',
        'latency_ms',
        'finish_reason',
        'error',
        'pruned_at',
        'usage_missing',
        'created_at',
      ])
      .where('trace_id', '=', id)
      .orderBy('seq', 'asc')
      .execute(),
    db
      .selectFrom('llm_tool_calls')
      .select([
        'id',
        'seq',
        'name',
        'input',
        'output',
        'duration_ms',
        'status',
        'pruned_at',
        'created_at',
      ])
      .where('trace_id', '=', id)
      .orderBy('seq', 'asc')
      .execute(),
  ])

  let totalTokens = 0
  for (const g of generations) {
    if (g.prompt_tokens !== null)
      totalTokens += g.prompt_tokens
    if (g.completion_tokens !== null)
      totalTokens += g.completion_tokens
  }

  let totalCost = '0.000000'
  const costs = generations.map(g => g.cost_usd).filter((c): c is string => c !== null)
  if (costs.length > 0) {
    const sum = costs.reduce((acc, c) => acc + Number.parseFloat(c), 0)
    totalCost = sum.toFixed(6)
  }

  const durationMs
    = trace.finished_at && trace.started_at
      ? trace.finished_at.getTime() - trace.started_at.getTime()
      : null

  return {
    trace: {
      id: trace.id,
      kind: trace.kind,
      status: trace.status,
      ownerType: trace.owner_type,
      ownerId: trace.owner_id,
      startedAt: trace.started_at.toISOString(),
      finishedAt: trace.finished_at?.toISOString() ?? null,
      error: trace.error,
      createdAt: trace.created_at.toISOString(),
      updatedAt: trace.updated_at.toISOString(),
    },
    generations: generations.map(g => ({
      id: g.id,
      seq: g.seq,
      llmUseCase: g.llm_use_case,
      provider: g.provider,
      model: g.model,
      prompt: g.prompt,
      response: g.response,
      promptTokens: g.prompt_tokens,
      completionTokens: g.completion_tokens,
      costUsd: g.cost_usd,
      latencyMs: g.latency_ms,
      finishReason: g.finish_reason,
      error: g.error,
      prunedAt: g.pruned_at?.toISOString() ?? null,
      usageMissing: g.usage_missing ?? false,
      createdAt: g.created_at.toISOString(),
    })),
    toolCalls: toolCalls.map(t => ({
      id: t.id,
      seq: t.seq,
      name: t.name,
      input: t.input,
      output: t.output,
      durationMs: t.duration_ms,
      status: t.status,
      prunedAt: t.pruned_at?.toISOString() ?? null,
      createdAt: t.created_at.toISOString(),
    })),
    totalTokens,
    totalCost,
    durationMs,
  }
})
