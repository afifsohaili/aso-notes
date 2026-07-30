export interface ResilientFetchOptions {
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number
  /** Maximum number of attempts (including the first try). */
  maxAttempts: number
  /** Base delay for exponential backoff with jitter. Defaults to 1000ms. */
  baseDelayMs?: number
  /** Injectable fetch implementation for tests. */
  fetchFn?: typeof fetch
  /** Injectable sleep implementation for tests. */
  sleepFn?: (ms: number) => Promise<void>
}

export class RateLimitError extends Error {
  retryAfterMs: number | null

  constructor(message: string, retryAfterMs: number | null) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientError'
  }
}

export class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}

/**
 * Parse a Retry-After header value.
 * Returns the delay in milliseconds, or null if the value is absent or unparseable.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value)
    return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    return seconds * 1000
  }
  const date = Date.parse(trimmed)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now())
  }
  return null
}

/**
 * Compose a per-attempt timeout signal with any caller-provided signal.
 * If the caller supplied an AbortSignal, both signals are combined with
 * AbortSignal.any so either aborting stops the request.
 */
function composeTimeoutSignal(timeoutMs: number, callerSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!callerSignal)
    return timeoutSignal
  return AbortSignal.any([timeoutSignal, callerSignal])
}

function isFatalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function computeBackoff(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** (attempt - 1)
}

function jitteredDelay(attempt: number, baseDelayMs: number): number {
  const maxDelay = computeBackoff(attempt, baseDelayMs)
  return Math.random() * maxDelay
}

export async function resilientFetch(
  url: string | URL | Request,
  init: RequestInit | undefined,
  options: ResilientFetchOptions,
): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch
  const sleepFn = options.sleepFn ?? sleep
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxAttempts = options.maxAttempts

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const signal = composeTimeoutSignal(options.timeoutMs, init?.signal)
    try {
      const response = await fetchFn(url, { ...init, signal })

      if (response.ok) {
        return response
      }

      const status = response.status
      const body = await response.clone().text()

      if (isFatalStatus(status)) {
        throw new FatalError(`Request failed (${status}): ${body}`)
      }

      if (status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
        if (attempt < maxAttempts) {
          await sleepFn(retryAfterMs ?? jitteredDelay(attempt, baseDelayMs))
          continue
        }
        throw new RateLimitError(`Rate limited (${status}): ${body}`, retryAfterMs)
      }

      if (status >= 500) {
        if (attempt < maxAttempts) {
          await sleepFn(jitteredDelay(attempt, baseDelayMs))
          continue
        }
        throw new TransientError(`Server error (${status}): ${body}`)
      }

      throw new FatalError(`Request failed (${status}): ${body}`)
    }
    catch (error) {
      if (error instanceof FatalError || error instanceof RateLimitError || error instanceof TransientError) {
        throw error
      }
      if (attempt < maxAttempts) {
        await sleepFn(jitteredDelay(attempt, baseDelayMs))
        continue
      }
      if (error instanceof Error) {
        throw new TransientError(`Request failed after ${maxAttempts} attempts: ${error.name}: ${error.message}`)
      }
      throw new TransientError(`Request failed after ${maxAttempts} attempts: ${String(error)}`)
    }
  }

  throw new TransientError(`Request failed after ${maxAttempts} attempts`)
}
