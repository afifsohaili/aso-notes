import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'

async function rowCount(trx: any, table: string): Promise<number> {
  const { rows } = await sql<{ c: number }>`SELECT count(*)::int AS c FROM ${sql.table(table)}`.execute(trx)
  return rows[0]!.c
}

async function givenTrace(
  trx: any,
  workspaceId: string,
  ownerId: string,
  kind: 'ingestion' | 'chat' | 'consolidation' = 'chat',
): Promise<string> {
  const row = await trx
    .insertInto('llm_traces')
    .values({
      workspace_id: workspaceId,
      kind,
      owner_type: 'conversations',
      owner_id: ownerId,
      status: 'running',
      started_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenGeneration(
  trx: any,
  workspaceId: string,
  traceId: string,
  seq: number,
): Promise<string> {
  const row = await trx
    .insertInto('llm_generations')
    .values({
      workspace_id: workspaceId,
      trace_id: traceId,
      seq,
      llm_use_case: 'agent',
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenToolCall(
  trx: any,
  workspaceId: string,
  traceId: string,
  seq: number,
): Promise<string> {
  const row = await trx
    .insertInto('llm_tool_calls')
    .values({
      workspace_id: workspaceId,
      trace_id: traceId,
      seq,
      name: 'search_notes',
      input: { query: 'x' },
      status: 'completed',
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

describe('llm tracing schema (Phase 1)', () => {
  test('all three tracing tables exist with expected columns', async ({ trx }) => {
    const { rows } = await sql<{ table_name: string, column_name: string }>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('llm_traces', 'llm_generations', 'llm_tool_calls')
      ORDER BY table_name, ordinal_position
    `.execute(trx)

    const columnsByTable = rows.reduce((map: Record<string, string[]>, row) => {
      map[row.table_name] = map[row.table_name] ?? []
      map[row.table_name]!.push(row.column_name)
      return map
    }, {})

    expect(columnsByTable.llm_traces).toEqual([
      'id',
      'workspace_id',
      'kind',
      'owner_type',
      'owner_id',
      'status',
      'started_at',
      'finished_at',
      'error',
      'created_at',
      'updated_at',
    ])
    expect(columnsByTable.llm_generations).toEqual([
      'id',
      'workspace_id',
      'trace_id',
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
      'created_at',
    ])
    expect(columnsByTable.llm_tool_calls).toEqual([
      'id',
      'workspace_id',
      'trace_id',
      'seq',
      'name',
      'input',
      'output',
      'duration_ms',
      'status',
      'pruned_at',
      'created_at',
    ])
  })

  test('messages has a nullable trace_id column and index', async ({ trx }) => {
    const { rows: columns } = await sql<{ column_name: string, is_nullable: string }>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'trace_id'
    `.execute(trx)
    expect(columns).toHaveLength(1)
    expect(columns[0]!.is_nullable).toBe('YES')

    const { rows: indexes } = await sql<{ indexdef: string }>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'messages' AND indexname = 'idx_messages_trace_id'
    `.execute(trx)
    expect(indexes).toHaveLength(1)
    expect(indexes[0]!.indexdef).toContain('trace_id')
  })

  test('insert round-trip for trace + generation + tool call', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Trace test' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const traceId = await givenTrace(trx, workspace.id, conversation.id)
    const generationId = await givenGeneration(trx, workspace.id, traceId, 1)
    const toolCallId = await givenToolCall(trx, workspace.id, traceId, 2)

    expect(await rowCount(trx, 'llm_traces')).toBe(1)
    expect(await rowCount(trx, 'llm_generations')).toBe(1)
    expect(await rowCount(trx, 'llm_tool_calls')).toBe(1)

    const trace = await trx
      .selectFrom('llm_traces')
      .select(['id', 'kind', 'owner_type', 'owner_id', 'status'])
      .where('id', '=', traceId)
      .executeTakeFirstOrThrow()
    expect(trace).toEqual({
      id: traceId,
      kind: 'chat',
      owner_type: 'conversations',
      owner_id: conversation.id,
      status: 'running',
    })

    const generation = await trx
      .selectFrom('llm_generations')
      .select(['id', 'trace_id', 'seq'])
      .where('id', '=', generationId)
      .executeTakeFirstOrThrow()
    expect(generation).toEqual({ id: generationId, trace_id: traceId, seq: 1 })

    const toolCall = await trx
      .selectFrom('llm_tool_calls')
      .select(['id', 'trace_id', 'seq'])
      .where('id', '=', toolCallId)
      .executeTakeFirstOrThrow()
    expect(toolCall).toEqual({ id: toolCallId, trace_id: traceId, seq: 2 })
  })

  test('nullable content columns accept null and return null', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Nullable test' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const traceId = await givenTrace(trx, workspace.id, conversation.id)
    await givenGeneration(trx, workspace.id, traceId, 1)
    await givenToolCall(trx, workspace.id, traceId, 1)

    const { rows } = await sql<{
      prompt: unknown
      response: unknown
      cost_usd: unknown
      output: unknown
    }>`
      SELECT
        (SELECT prompt FROM llm_generations WHERE trace_id = ${traceId}) AS prompt,
        (SELECT response FROM llm_generations WHERE trace_id = ${traceId}) AS response,
        (SELECT cost_usd FROM llm_generations WHERE trace_id = ${traceId}) AS cost_usd,
        (SELECT output FROM llm_tool_calls WHERE trace_id = ${traceId}) AS output
    `.execute(trx)

    expect(rows[0]!.prompt).toBeNull()
    expect(rows[0]!.response).toBeNull()
    expect(rows[0]!.cost_usd).toBeNull()
    expect(rows[0]!.output).toBeNull()
  })

  test('seq orders generations and tool calls within a trace', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Seq test' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const traceId = await givenTrace(trx, workspace.id, conversation.id)
    const gen1 = await givenGeneration(trx, workspace.id, traceId, 10)
    const gen2 = await givenGeneration(trx, workspace.id, traceId, 5)
    const gen3 = await givenGeneration(trx, workspace.id, traceId, 7)

    const rows = await trx
      .selectFrom('llm_generations')
      .select(['id', 'seq'])
      .where('trace_id', '=', traceId)
      .orderBy('seq', 'asc')
      .execute()
    expect(rows.map(r => r.id)).toEqual([gen2, gen3, gen1])
  })

  test('deleting a trace cascade-deletes generations and tool calls', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Cascade test' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const traceId = await givenTrace(trx, workspace.id, conversation.id)
    await givenGeneration(trx, workspace.id, traceId, 1)
    await givenToolCall(trx, workspace.id, traceId, 1)
    expect(await rowCount(trx, 'llm_generations')).toBe(1)
    expect(await rowCount(trx, 'llm_tool_calls')).toBe(1)

    await trx.deleteFrom('llm_traces').where('id', '=', traceId).execute()
    expect(await rowCount(trx, 'llm_traces')).toBe(0)
    expect(await rowCount(trx, 'llm_generations')).toBe(0)
    expect(await rowCount(trx, 'llm_tool_calls')).toBe(0)
  })

  test('deleting a workspace cascade-deletes all tracing rows and their indexes', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const other = await givenVerifiedUser()

    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Workspace cascade test' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const traceId = await givenTrace(trx, workspace.id, conversation.id)
    await givenGeneration(trx, workspace.id, traceId, 1)
    await givenToolCall(trx, workspace.id, traceId, 1)

    // Other workspace trace must survive.
    const otherConversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: other.workspace.id, title: 'Other workspace' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const otherTraceId = await givenTrace(trx, other.workspace.id, otherConversation.id)
    await givenGeneration(trx, other.workspace.id, otherTraceId, 1)

    await trx.deleteFrom('workspaces').where('id', '=', workspace.id).execute()

    expect(await rowCount(trx, 'llm_traces')).toBe(1)
    expect(await rowCount(trx, 'llm_generations')).toBe(1)
    expect(await rowCount(trx, 'llm_tool_calls')).toBe(0)
  })

  test('messages.trace_id can be set and read back', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspace.id, title: 'Message trace test' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const traceId = await givenTrace(trx, workspace.id, conversation.id)

    const message = await trx
      .insertInto('messages')
      .values({
        workspace_id: workspace.id,
        conversation_id: conversation.id,
        role: 'assistant',
        content: 'answer',
        trace_id: traceId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const row = await trx
      .selectFrom('messages')
      .select('trace_id')
      .where('id', '=', message.id)
      .executeTakeFirstOrThrow()
    expect(row.trace_id).toBe(traceId)
  })
})
