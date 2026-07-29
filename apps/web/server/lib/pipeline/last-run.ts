import type { PipelineContext } from './context'

/**
 * Fixed schema for `notes.last_run` (plan-004).
 *
 * Kept as a plain TS interface plus a hand-rolled validator. The repo does not
 * currently depend on zod, so we avoid adding a dependency for a single schema.
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
    messages: { role: string, content: string }[]
    response: string
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

  const messages = value.messages
  if (!Array.isArray(messages) || !messages.every(isMessage))
    return false

  const usage = value.usage
  if (usage !== null && !isUsage(usage))
    return false

  return isString(value.strategy)
    && isString(value.model)
    && isString(value.response)
    && isCounts(value.counts)
}

export interface BuildLastRunOptions {
  status: 'succeeded' | 'failed'
  error?: unknown
  worker?: { attemptsMade?: number, jobId?: string | null } | null
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

  return json as LastRun
}
