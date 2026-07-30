import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { FatalError, RateLimitError, TransientError } from '../../server/lib/ai/resilient-fetch'
import { mapIngestionWorkerError } from '../../server/lib/sync/ingestion-worker-error-policy'

describe('mapIngestionWorkerError', () => {
  function fakeQueue(): { queue: Pick<Queue, 'rateLimit'>, rateLimitCalls: number[] } {
    const rateLimitCalls: number[] = []
    const queue = {
      rateLimit: vi.fn(async (ms: number) => { rateLimitCalls.push(ms) }),
    } as unknown as Pick<Queue, 'rateLimit'> & { rateLimit: ReturnType<typeof vi.fn> }
    return { queue, rateLimitCalls }
  }

  it('rate-limits the queue using Retry-After and throws BullMQ RateLimitError', async () => {
    const { queue, rateLimitCalls } = fakeQueue()

    const result = await mapIngestionWorkerError({
      error: new RateLimitError('rate limited', 12_000),
      queue: queue as any,
      defaultRateLimitDurationMs: 60_000,
    })

    expect(rateLimitCalls).toEqual([12_000])
    expect(result).toBeInstanceOf(Error)
    expect(result.name).toBe('RateLimitError')
  })

  it('rate-limits the queue with the default duration when Retry-After is missing', async () => {
    const { queue, rateLimitCalls } = fakeQueue()

    const result = await mapIngestionWorkerError({
      error: new RateLimitError('rate limited', null),
      queue: queue as any,
      defaultRateLimitDurationMs: 60_000,
    })

    expect(rateLimitCalls).toEqual([60_000])
    expect(result.name).toBe('RateLimitError')
  })

  it('throws UnrecoverableError for FatalError so BullMQ does not retry', async () => {
    const { queue } = fakeQueue()

    const result = await mapIngestionWorkerError({
      error: new FatalError('invalid request'),
      queue: queue as any,
    })

    expect(result.name).toBe('UnrecoverableError')
    expect(result.message).toBe('invalid request')
    expect(queue.rateLimit).not.toHaveBeenCalled()
  })

  it('returns TransientError unchanged so BullMQ retries normally', async () => {
    const { queue } = fakeQueue()
    const error = new TransientError('server error')

    const result = await mapIngestionWorkerError({ error, queue: queue as any })

    expect(result).toBe(error)
    expect(queue.rateLimit).not.toHaveBeenCalled()
  })

  it('returns plain errors unchanged', async () => {
    const { queue } = fakeQueue()
    const error = new Error('boom')

    const result = await mapIngestionWorkerError({ error, queue: queue as any })

    expect(result).toBe(error)
    expect(queue.rateLimit).not.toHaveBeenCalled()
  })

  it('wraps non-error values in an Error', async () => {
    const { queue } = fakeQueue()

    const result = await mapIngestionWorkerError({ error: 'string failure', queue: queue as any })

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('string failure')
  })
})
