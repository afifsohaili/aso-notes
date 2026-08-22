import type { DB } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { PipelineContext } from './context'

/**
 * Fixed schema for `notes.last_run` (plan-004).
 *
 * Kept as a plain TS interface plus a hand-rolled validator. The repo does not
 * currently depend on zod, so we avoid adding a dependency for a single schema.
 *
 * Phase 3: the extraction block stores a `trace_id` pointing at
 * `llm_generations`; the heavy `messages`/`response` are no longer duplicated.
 * Legacy rows that still inline `messages`/`response` remain readable.
 */

export interface LastRun {
  pipeline: string
  status: 'succeeded' | 'failed'
  failed_stage: string | null
  error: { name: string, message: string, stack?: string } | null
  attempt: number
  job_id: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  chunks: number | null
  extraction: {
    strategy: string
    model: string
    trace_id?: string
    messages?: { role: string, content: string }[]
    response?: string
    usage: { prompt_tokens: number, completion_tokens: number } | null
    counts: { concepts: number, relations: number, mentions: number, tags: number }
  } | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value)
}

function isMessage(value: unknown): value is { role: string, content: string } {
  if (!isObject(value))
    return false
  return isString(value.role) && isString(value.content)
}

function isUsage(value: unknown): value is { prompt_tokens: number, completion_tokens: number } {
  if (!isObject(value))
    return false
  return isNumber(value.prompt_tokens) && isNumber(value.completion_tokens)
}

function isCounts(value: unknown): value is { concepts: number, relations: number, mentions: number, tags: number } {
  if (!isObject(value))
    return false
  return isNumber(value.concepts)
    && isNumber(value.relations)
    && isNumber(value.mentions)
    && isNumber(value.tags)
}

function isError(value: unknown): value is { name: string, message: string, stack?: string } {
  if (!isObject(value))
    return false
  return isString(value.name)
    && isString(value.message)
    && (value.stack === undefined || isString(value.stack))
}

function isExtraction(value: unknown): value is NonNullable<LastRun['extraction']> {
  if (!isObject(value))
    return false

  const usage = value.usage
  if (usage !== null && !isUsage(usage))
    return false

  if (!isString(value.strategy)
    || !isString(value.model)
    || !isCounts(value.counts)) {
    return false
  }

  // Phase 3 pointer model: trace_id references llm_generations.
  if (isString(value.trace_id))
    return true

  // Legacy inline model: messages + response are stored in last_run.
  const messages = value.messages
  const response = value.response
  if (Array.isArray(messages) && messages.every(isMessage) && isString(response))
    return true

  return false
}

export type LastRunSummary = Omit<LastRun, 'extraction'> & {
  extraction: Omit<NonNullable<LastRun['extraction']>, 'trace_id' | 'messages' | 'response'> | null
}

export interface BuildLastRunOptions {
  status: 'succeeded' | 'failed'
  error?: unknown
  worker?: { attemptsMade?: number, jobId?: string | null } | null
}

/** Strip large extraction fields and internal trace pointer for note list serialization. */
export function toLastRunSummary(lastRun: LastRun): LastRunSummary {
  const { extraction, ...rest } = lastRun
  return {
    ...rest,
    extraction: extraction
      ? {
          strategy: extraction.strategy,
          model: extraction.model,
          usage: extraction.usage,
          counts: extraction.counts,
        }
      : null,
  }
}

/**
 * Detail view of a {@link LastRun} with heavy extraction fields hydrated from
 * llm_generations.
 *
 * Phase 3: if `extraction.trace_id` is present, messages/response are read from
 * the linked generation row. Otherwise the legacy inline payload is returned as-is.
 */
export interface LastRunDetail extends LastRun {
  extraction: {
    strategy: string
    model: string
    messages: { role: string, content: string }[]
    response: string
    usage: { prompt_tokens: number, completion_tokens: number } | null
    counts: { concepts: number, relations: number, mentions: number, tags: number }
  } | null
}

export async function hydrateLastRunDetail(
  db: Kysely<DB>,
  workspaceId: string,
  lastRun: LastRun,
): Promise<LastRunDetail> {
  const extraction = lastRun.extraction
  if (!extraction)
    return lastRun as LastRunDetail

  // Legacy inline payload — return as-is.
  if (!extraction.trace_id || extraction.trace_id === 'unknown') {
    return {
      ...lastRun,
      extraction: {
        strategy: extraction.strategy,
        model: extraction.model,
        messages: extraction.messages ?? [],
        response: extraction.response ?? '',
        usage: extraction.usage,
        counts: extraction.counts,
      },
    }
  }

  const generation = await db
    .selectFrom('llm_generations')
    .select(['prompt', 'response'])
    .where('trace_id', '=', extraction.trace_id)
    .where('workspace_id', '=', workspaceId)
    .where('llm_use_case', '=', 'extraction')
    .orderBy('seq', 'asc')
    .executeTakeFirst()

  if (!generation) {
    return {
      ...lastRun,
      extraction: {
        strategy: extraction.strategy,
        model: extraction.model,
        messages: [],
        response: '',
        usage: extraction.usage,
        counts: extraction.counts,
      },
    }
  }

  const prompt = generation.prompt as { role: string, content: string }[] | null
  const responseObj = generation.response as { role: string, content: string } | null

  return {
    ...lastRun,
    extraction: {
      strategy: extraction.strategy,
      model: extraction.model,
      messages: prompt ?? [],
      response: responseObj?.content ?? '',
      usage: extraction.usage,
      counts: extraction.counts,
    },
  }
}

function serializeError(error: unknown): LastRun['error'] {
  if (error === undefined || error === null)
    return null
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack }
  return { name: 'Error', message: String(error) }
}

/** Build a {@link LastRun} record from a completed pipeline run. */
export function buildLastRun(ctx: PipelineContext, options: BuildLastRunOptions): LastRun {
  const finishedAt = new Date()
  const startedAt = ctx.startedAt
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime())
  const worker = options.worker ?? null

  return {
    pipeline: ctx.note.pipeline,
    status: options.status,
    failed_stage: options.status === 'failed' ? ctx.currentStage : null,
    error: serializeError(options.error),
    attempt: worker?.attemptsMade ?? 0,
    job_id: worker?.jobId ?? null,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    chunks: ctx.chunksCount,
    extraction: ctx.extractionRecord,
  }
}

/** Validates and narrows an unknown value to a {@link LastRun}. */
export function parseLastRun(json: unknown): LastRun | null {
  if (!isObject(json))
    return null

  const status = json.status
  if (status !== 'succeeded' && status !== 'failed')
    return null

  const error = json.error
  if (error !== null && !isError(error))
    return null

  const extraction = json.extraction
  if (extraction !== null && !isExtraction(extraction))
    return null

  if (!isString(json.pipeline)
    || !isNullableString(json.failed_stage)
    || !isNumber(json.attempt)
    || !isNullableString(json.job_id)
    || !isString(json.started_at)
    || !isString(json.finished_at)
    || !isNumber(json.duration_ms)
    || !isNullableNumber(json.chunks)) {
    return null
  }

  return json as unknown as LastRun
}
