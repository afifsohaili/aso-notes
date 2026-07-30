import type { Queue } from 'bullmq'
import type { IngestNoteJobData } from './dispatcher'
import { RateLimitError as BullMQRateLimitError, UnrecoverableError } from 'bullmq'
import { FatalError, RateLimitError } from '../ai/resilient-fetch'

export const DEFAULT_RATE_LIMIT_DURATION_MS = 60_000

/**
 * Map provider-level resilient errors to BullMQ control errors.
 *
 * - RateLimitError: rate-limit the queue so the whole worker pauses for the
 *   provider's Retry-After (or a sensible fallback), then throw BullMQ's
 *   RateLimitError so the current job moves back to the wait list instead of
 *   burning attempts.
 * - FatalError (non-retryable 4xx): throw UnrecoverableError so BullMQ moves
 *   the job straight to failed without further retries.
 * - Other errors (TransientError, plain Error, etc.): return them unchanged so
 *   BullMQ applies its normal retry/backoff policy.
 */
export async function mapIngestionWorkerError(args: {
  error: unknown
  queue: Queue<IngestNoteJobData>
  defaultRateLimitDurationMs?: number
}): Promise<Error> {
  const { error, queue, defaultRateLimitDurationMs = DEFAULT_RATE_LIMIT_DURATION_MS } = args

  if (error instanceof RateLimitError) {
    await queue.rateLimit(error.retryAfterMs ?? defaultRateLimitDurationMs)
    return new BullMQRateLimitError()
  }

  if (error instanceof FatalError) {
    return new UnrecoverableError(error.message)
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
