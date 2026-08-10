import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'

export type TraceKind = 'ingestion' | 'chat' | 'consolidation'
export type TraceStatus = 'running' | 'completed' | 'failed' | 'aborted'

export interface CreateTraceInput {
  workspaceId: string
  kind: TraceKind
  ownerType: string
  ownerId: string
  status?: TraceStatus
  startedAt?: Date
  error?: string | null
}

export interface AppendGenerationInput {
  workspaceId: string
  traceId: string
  seq: number
  llmUseCase: string
  provider: string
  model: string
  prompt?: unknown
  response?: unknown
  promptTokens?: number | null
  completionTokens?: number | null
  costUsd?: string | null
  latencyMs?: number
  finishReason?: string | null
  error?: string | null
  usageMissing?: boolean
}

export interface AppendToolCallInput {
  workspaceId: string
  traceId: string
  seq: number
  name: string
  input: unknown
  output?: unknown
  durationMs?: number
  status: string
}

export interface FinishTraceInput {
  traceId: string
  status: TraceStatus
  error?: string | null
}

function jsonb(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

export async function createTrace(
  db: Kysely<Database>,
  input: CreateTraceInput,
): Promise<string> {
  const row = await db
    .insertInto('llm_traces')
    .values({
      workspace_id: input.workspaceId,
      kind: input.kind,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      status: input.status ?? 'running',
      started_at: input.startedAt ?? new Date(),
      error: input.error ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

export async function appendGeneration(
  db: Kysely<Database>,
  input: AppendGenerationInput,
): Promise<string> {
  const row = await db
    .insertInto('llm_generations')
    .values({
      workspace_id: input.workspaceId,
      trace_id: input.traceId,
      seq: input.seq,
      llm_use_case: input.llmUseCase,
      provider: input.provider,
      model: input.model,
      prompt: jsonb(input.prompt),
      response: jsonb(input.response),
      prompt_tokens: input.promptTokens ?? null,
      completion_tokens: input.completionTokens ?? null,
      cost_usd: input.costUsd ?? null,
      latency_ms: input.latencyMs ?? null,
      finish_reason: input.finishReason ?? null,
      error: input.error ?? null,
      usage_missing: input.usageMissing ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

export async function appendToolCall(
  db: Kysely<Database>,
  input: AppendToolCallInput,
): Promise<string> {
  const row = await db
    .insertInto('llm_tool_calls')
    .values({
      workspace_id: input.workspaceId,
      trace_id: input.traceId,
      seq: input.seq,
      name: input.name,
      input: jsonb(input.input),
      output: jsonb(input.output),
      duration_ms: input.durationMs ?? null,
      status: input.status,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

export async function finishTrace(
  db: Kysely<Database>,
  input: FinishTraceInput,
): Promise<void> {
  await db
    .updateTable('llm_traces')
    .set({
      status: input.status,
      finished_at: new Date(),
      error: input.error ?? null,
    })
    .where('id', '=', input.traceId)
    .execute()
}

export function safeTraceWrite<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  return operation().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[trace-write] ${label} failed: ${message}`)
    return undefined
  })
}
