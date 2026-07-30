import { describe, expect, it } from 'vitest'
import { resilientFetch } from '../../server/lib/ai/resilient-fetch'

function okResponse(body: string) {
  return new Response(body, { status: 200 })
}

describe('resilientFetch', () => {
  it('returns the response on first successful attempt', async () => {
    const calls: { url: string, init: RequestInit }[] = []
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return okResponse('hello')
    }

    const response = await resilientFetch('https://example.com/test', { method: 'POST' }, {
      timeoutMs: 5000,
      maxAttempts: 3,
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(calls).toHaveLength(1)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
  })

  it('retries 429 using Retry-After header then returns the successful response', async () => {
    const sleeps: number[] = []
    const sleepFn = async (ms: number) => {
      sleeps.push(ms)
    }
    let attempt = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      attempt++
      if (attempt === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        })
      }
      return okResponse('success')
    }

    const response = await resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 3,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    })

    expect(attempt).toBe(2)
    expect(sleeps).toEqual([2000])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('success')
  })

  it('retries 429 without Retry-After using exponential backoff', async () => {
    const sleeps: number[] = []
    const sleepFn = async (ms: number) => {
      sleeps.push(ms)
    }
    let attempt = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      attempt++
      if (attempt <= 2) {
        return new Response('rate limited', { status: 429 })
      }
      return okResponse('success')
    }

    const response = await resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 4,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    })

    expect(attempt).toBe(3)
    expect(sleeps).toHaveLength(2)
    expect(sleeps[0]!).toBeGreaterThanOrEqual(0)
    expect(sleeps[0]!).toBeLessThan(1000)
    expect(sleeps[1]!).toBeGreaterThanOrEqual(0)
    expect(sleeps[1]!).toBeLessThan(2000)
    expect(response.status).toBe(200)
  })

  it('throws RateLimitError with retryAfterMs and OpenRouter X-RateLimit context when exhausted', async () => {
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response('too many requests', {
        status: 429,
        headers: {
          'Retry-After': '5',
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '1234567890',
        },
      })
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 2,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('RateLimitError')
      expect(error.message).toContain('too many requests')
      expect((error as any).retryAfterMs).toBe(5000)
      expect((error as any).context).toEqual({
        limit: '20',
        remaining: '0',
        reset: '1234567890',
      })
      return true
    })
  })

  it('retries 5xx with backoff then returns the successful response', async () => {
    const sleeps: number[] = []
    const sleepFn = async (ms: number) => {
      sleeps.push(ms)
    }
    let attempt = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      attempt++
      if (attempt === 1) {
        return new Response('server error', { status: 500 })
      }
      return okResponse('success')
    }

    const response = await resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 3,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    })

    expect(attempt).toBe(2)
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]!).toBeGreaterThanOrEqual(0)
    expect(sleeps[0]!).toBeLessThan(1000)
    expect(response.status).toBe(200)
  })

  it('throws TransientError with body text when 5xx is exhausted', async () => {
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response('internal server error', { status: 503 })
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 2,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('TransientError')
      expect(error.message).toContain('503')
      expect(error.message).toContain('internal server error')
      return true
    })
  })

  it('retries fetch rejection with backoff then returns the successful response', async () => {
    const sleeps: number[] = []
    const sleepFn = async (ms: number) => {
      sleeps.push(ms)
    }
    let attempt = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      attempt++
      if (attempt === 1) {
        throw new TypeError('fetch failed')
      }
      return okResponse('success')
    }

    const response = await resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 3,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    })

    expect(attempt).toBe(2)
    expect(sleeps).toHaveLength(1)
    expect(response.status).toBe(200)
  })

  it('throws TransientError when fetch rejection is exhausted', async () => {
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      throw new TypeError('network error')
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 2,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('TransientError')
      expect(error.message).toContain('network error')
      return true
    })
  })

  it('throws TransientError when fetch rejects with an AbortError/TimeoutError', async () => {
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      const error = new Error('The operation was aborted')
      error.name = 'TimeoutError'
      throw error
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 2,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('TransientError')
      expect(error.message).toContain('TimeoutError')
      return true
    })
  })

  it('throws TransientError when a real timeout fires before fetch resolves', async () => {
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((resolve) => {
        init?.signal?.addEventListener('abort', () => resolve())
      })
      throw new Error('should not reach here')
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 20,
      maxAttempts: 2,
      baseDelayMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('TransientError')
      return true
    })
  })

  it('throws FatalError immediately on non-retryable 4xx status codes', async () => {
    const statuses = [400, 401, 402, 403, 404]
    for (const status of statuses) {
      let calls = 0
      const sleeps: number[] = []
      const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
        calls++
        return new Response(`bad request ${status}`, { status })
      }
      const sleepFn = async (ms: number) => {
        sleeps.push(ms)
      }

      await expect(resilientFetch('https://example.com/test', {}, {
        timeoutMs: 5000,
        maxAttempts: 3,
        fetchFn: fetchFn as unknown as typeof fetch,
        sleepFn,
      })).rejects.toSatisfy((error: Error) => {
        expect(error.name).toBe('FatalError')
        expect(error.message).toContain(String(status))
        expect(error.message).toContain(`bad request ${status}`)
        return true
      })

      expect(calls).toBe(1)
      expect(sleeps).toHaveLength(0)
    }
  })

  it('keeps jittered backoff within [0, computed] bounds across many attempts', async () => {
    const sleeps: number[] = []
    const sleepFn = async (ms: number) => {
      sleeps.push(ms)
    }
    let attempt = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      attempt++
      if (attempt <= 4) {
        return new Response('rate limited', { status: 429 })
      }
      return okResponse('success')
    }

    await resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 5,
      baseDelayMs: 100,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
    })

    expect(sleeps).toHaveLength(4)
    for (let i = 0; i < sleeps.length; i++) {
      expect(sleeps[i]!).toBeGreaterThanOrEqual(0)
      expect(sleeps[i]!).toBeLessThan(100 * 2 ** i)
    }
  })

  it('does not retry when maxAttempts is 1', async () => {
    let calls = 0
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) => {
      calls++
      return new Response('rate limited', { status: 429 })
    }

    await expect(resilientFetch('https://example.com/test', {}, {
      timeoutMs: 5000,
      maxAttempts: 1,
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => {
      },
    })).rejects.toSatisfy((error: Error) => {
      expect(error.name).toBe('RateLimitError')
      return true
    })

    expect(calls).toBe(1)
  })
})
