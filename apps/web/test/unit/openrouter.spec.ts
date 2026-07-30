import { describe, expect, it } from 'vitest'
import { OpenRouterEmbeddingProvider } from '../../server/lib/ai/openrouter-embedding'
import { OpenRouterLLMProvider } from '../../server/lib/ai/openrouter-llm'
import { FatalError, RateLimitError, TransientError } from '../../server/lib/ai/resilient-fetch'

interface MockCall {
  url: string
  init: RequestInit
}

function mockFetch(status: number, body: unknown) {
  const calls: MockCall[] = []
  const fetchFn = async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchFn: fetchFn as typeof fetch }
}

function sequenceFetch(scenarios: Array<{ status: number, body: unknown, headers?: Record<string, string> }>) {
  const calls: MockCall[] = []
  let attempt = 0
  const fetchFn = async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    const { status, body, headers = { 'content-type': 'application/json' } } = scenarios[attempt++] ?? { status: 200, body: {} }
    return new Response(JSON.stringify(body), { status, headers })
  }
  return { calls, fetchFn: fetchFn as typeof fetch }
}

async function sleepFn() {}

function timedOutFetch<T>(attemptsToFail: number, successBody: T) {
  let attempt = 0
  return async (url: any, init: any) => {
    attempt++
    if (attempt <= attemptsToFail) {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const error = new Error('The operation was aborted')
          error.name = 'TimeoutError'
          reject(error)
        }
        if (init.signal?.aborted) {
          onAbort()
          return
        }
        init.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    return new Response(JSON.stringify(successBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('openRouterEmbeddingProvider', () => {
  it('posts texts to the embeddings endpoint and returns embeddings in input order', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      data: [
        { index: 1, embedding: [0.2, 0.2] },
        { index: 0, embedding: [0.1, 0.1] },
      ],
    })
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk-test', model: 'embed-model', fetchFn })

    const result = await provider.embed(['first', 'second'])

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body))).toEqual({ model: 'embed-model', input: ['first', 'second'] })
    // ordered by index, not by response order
    expect(result).toEqual([[0.1, 0.1], [0.2, 0.2]])
  })

  it('throws RateLimitError with status and body on a 429 response', async () => {
    const { fetchFn } = mockFetch(429, { error: { message: 'rate limited' } })
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk-test', fetchFn, sleepFn })
    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.message).toMatch(/429.*rate limited|rate limited.*429/)
      expect((error as RateLimitError).retryAfterMs).toBeNull()
      return true
    })
  })
})

describe('openRouterLLMProvider', () => {
  it('shapes messages, tools and response_format into the chat/completions wire format', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{"q":"rag"}' } }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk-test', model: 'chat-model', fetchFn })

    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'you are an agent' },
        { role: 'user', content: 'find rag notes' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'call_0', name: 'search_notes', arguments: '{"q":"x"}' }] },
        { role: 'tool', content: '[]', toolCallId: 'call_0' },
      ],
      tools: [{ name: 'search_notes', description: 'vector search', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
      toolChoice: 'auto',
      responseFormat: { type: 'json_object' },
      maxTokens: 500,
      temperature: 0.2,
    })

    const { url, init } = calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('chat-model')
    expect(body.messages).toEqual([
      { role: 'system', content: 'you are an agent' },
      { role: 'user', content: 'find rag notes' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'search_notes', arguments: '{"q":"x"}' } }] },
      { role: 'tool', content: '[]', tool_call_id: 'call_0' },
    ])
    expect(body.tools).toEqual([{
      type: 'function',
      function: { name: 'search_notes', description: 'vector search', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    }])
    expect(body.tool_choice).toBe('auto')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.2)

    expect(result.message.role).toBe('assistant')
    expect(result.message.toolCalls).toEqual([{ id: 'call_1', name: 'search_notes', arguments: '{"q":"rag"}' }])
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
  })

  it('maps json_schema response format to the OpenAI wire shape', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '{"concepts":[]}' } }],
    })
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk-test', model: 'chat-model', fetchFn })

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'extract' }],
      responseFormat: { type: 'json_schema', jsonSchema: { name: 'extraction', schema: { type: 'object' }, strict: true } },
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'extraction', schema: { type: 'object' }, strict: true },
    })
    expect(result.message.content).toBe('{"concepts":[]}')
    expect(result.message.toolCalls).toBeUndefined()
    expect(result.usage).toBeUndefined()
  })

  it('throws FatalError with status and body on a non-retryable 4xx response', async () => {
    const { fetchFn } = mockFetch(401, { error: { message: 'bad key' } })
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk-bad', fetchFn, sleepFn })
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(FatalError)
      expect(error.message).toMatch(/401/)
      return true
    })
  })
})

describe('openRouterEmbeddingProvider resilience', () => {
  it('retries 429 with Retry-After and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
      { status: 200, body: { data: [{ index: 0, embedding: [0.1] }] } },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.embed(['x'])

    expect(calls).toHaveLength(2)
    expect(result).toEqual([[0.1]])
  })

  it('throws RateLimitError when 429 is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.message).toMatch(/429/)
      expect((error as RateLimitError).retryAfterMs).toBe(1000)
      return true
    })
  })

  it('throws FatalError immediately for 400, 401, 402 and 404', async () => {
    for (const status of [400, 401, 402, 404]) {
      const { calls, fetchFn } = sequenceFetch([{ status, body: { error: 'bad' } }])
      const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

      await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
        expect(error).toBeInstanceOf(FatalError)
        expect(error.message).toMatch(new RegExp(String(status)))
        return true
      })
      expect(calls).toHaveLength(1)
    }
  })

  it('retries 5xx and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'server error' } },
      { status: 200, body: { data: [{ index: 0, embedding: [0.1] }] } },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.embed(['x'])

    expect(calls).toHaveLength(2)
    expect(result).toEqual([[0.1]])
  })

  it('throws TransientError when 5xx is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 500, body: { error: 'server error' } },
      { status: 500, body: { error: 'server error' } },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
  })

  it('retries a timed-out fetch and returns the successful response', async () => {
    const fetchFn = timedOutFetch(1, { data: [{ index: 0, embedding: [0.1] }] })
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 1, maxAttempts: 2 })

    const result = await provider.embed(['x'])

    expect(result).toEqual([[0.1]])
  })
})

describe('openRouterLLMProvider resilience', () => {
  it('retries 429 with Retry-After and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ])
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(calls).toHaveLength(2)
    expect(result.message.content).toBe('ok')
  })

  it('throws RateLimitError when 429 is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '1', 'content-type': 'application/json' } },
    ])
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.message).toMatch(/429/)
      expect((error as RateLimitError).retryAfterMs).toBe(1000)
      return true
    })
  })

  it('throws FatalError immediately for 400, 401, 402 and 404', async () => {
    for (const status of [400, 401, 402, 404]) {
      const { calls, fetchFn } = sequenceFetch([{ status, body: { error: 'bad' } }])
      const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
        expect(error).toBeInstanceOf(FatalError)
        expect(error.message).toMatch(new RegExp(String(status)))
        return true
      })
      expect(calls).toHaveLength(1)
    }
  })

  it('retries 5xx and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'server error' } },
      { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } },
    ])
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(calls).toHaveLength(2)
    expect(result.message.content).toBe('ok')
  })

  it('throws TransientError when 5xx is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 500, body: { error: 'server error' } },
      { status: 500, body: { error: 'server error' } },
    ])
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
  })

  it('retries a timed-out fetch and returns the successful response', async () => {
    const fetchFn = timedOutFetch(1, { choices: [{ message: { role: 'assistant', content: 'ok' } }] })
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk', model: 'm', fetchFn, sleepFn, timeoutMs: 1, maxAttempts: 2 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.message.content).toBe('ok')
  })
})
