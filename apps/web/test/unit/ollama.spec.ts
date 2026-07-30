import { describe, expect, it } from 'vitest'
import { OllamaEmbeddingProvider, OllamaLLMProvider } from '../../server/lib/ai/ollama'
import { FatalError, TransientError } from '../../server/lib/ai/resilient-fetch'

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

function timedOutChatFetch(attemptsToFail: number) {
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
    return new Response(JSON.stringify({ message: { role: 'assistant', content: 'ok' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

function timedOutEmbedFetch(attemptsToFail: number) {
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
    return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('ollamaLLMProvider', () => {
  it('posts to /api/chat with stream:false and maps the response', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      message: { role: 'assistant', content: 'hello back' },
      prompt_eval_count: 12,
      eval_count: 7,
    })
    const provider = new OllamaLLMProvider({ model: 'gemma3:4b', fetchFn })

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe('gemma3:4b')
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])

    expect(result.message.content).toBe('hello back')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 7 })
  })

  it('maps tools, tool_choice none (omit tools), and response format to native fields', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      message: { role: 'assistant', content: '{}' },
    })
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_notes', description: 'search', parameters: { type: 'object' } }],
      responseFormat: { type: 'json_schema', jsonSchema: { name: 'extraction', schema: { type: 'object' } } },
    })
    let body = JSON.parse(String(calls[0]!.init.body))
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'search_notes', description: 'search', parameters: { type: 'object' } } }])
    expect(body.format).toEqual({ type: 'object' })

    await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_notes', description: 'search', parameters: { type: 'object' } }],
      toolChoice: 'none',
    })
    body = JSON.parse(String(calls[1]!.init.body))
    expect(body.tools).toBeUndefined()
  })

  it('maps tool_calls back to OpenAI-style ToolCalls with generated ids and JSON-string arguments', async () => {
    const { fetchFn } = mockFetch(200, {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ function: { name: 'search_notes', arguments: { query: 'rag', limit: 5 } } }],
      },
    })
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'find' }] })

    expect(result.message.toolCalls).toHaveLength(1)
    const call = result.message.toolCalls![0]!
    expect(call.name).toBe('search_notes')
    expect(JSON.parse(call.arguments)).toEqual({ query: 'rag', limit: 5 })
    expect(typeof call.id).toBe('string')
    expect(call.id.length).toBeGreaterThan(0)
  })

  it('maps assistant toolCalls to native messages with object arguments', async () => {
    const { calls, fetchFn } = mockFetch(200, { message: { role: 'assistant', content: 'ok' } })
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [
        { role: 'user', content: 'find' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'search_notes', arguments: '{"query":"rag"}' }],
        },
        { role: 'tool', content: '{"notes":[]}', toolCallId: 'call-1' },
      ],
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.messages[1].tool_calls).toEqual([{ function: { name: 'search_notes', arguments: { query: 'rag' } } }])
    expect(body.messages[2]).toEqual({ role: 'tool', content: '{"notes":[]}' })
  })

  it('honours a custom baseUrl and throws TransientError on a 5xx response', async () => {
    const { calls, fetchFn } = mockFetch(500, { error: 'boom' })
    const provider = new OllamaLLMProvider({ model: 'm', baseUrl: 'http://host.docker.internal:11434', fetchFn, sleepFn })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
    expect(calls[0]!.url).toBe('http://host.docker.internal:11434/api/chat')
  })
})

describe('ollamaEmbeddingProvider', () => {
  it('posts to /api/embed with batched input and returns embeddings in order', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
    })
    const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text', fetchFn, dimensions: 2 })

    const result = await provider.embed(['a', 'b'])

    expect(calls[0]!.url).toBe('http://localhost:11434/api/embed')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toEqual({ model: 'nomic-embed-text', input: ['a', 'b'], dimensions: 2 })
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })

  it('requests the graph-store width by default', async () => {
    const { calls, fetchFn } = mockFetch(200, { embeddings: [Array.from({ length: 2048 }).fill(0)] })
    const provider = new OllamaEmbeddingProvider({ model: 'embeddinggemma:300m', fetchFn })

    await provider.embed(['x'])

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.dimensions).toBe(2048)
  })

  it('zero-pads embeddings shorter than the target dimensions', async () => {
    const { fetchFn } = mockFetch(200, { embeddings: [[0.5, -0.5]] })
    const provider = new OllamaEmbeddingProvider({ model: 'embeddinggemma:300m', fetchFn, dimensions: 4 })

    const result = await provider.embed(['x'])

    expect(result).toEqual([[0.5, -0.5, 0, 0]])
  })

  it('throws when the model returns more dimensions than the target', async () => {
    const { fetchFn } = mockFetch(200, { embeddings: [[0.1, 0.2, 0.3]] })
    const provider = new OllamaEmbeddingProvider({ model: 'embeddinggemma:300m', fetchFn, dimensions: 2 })

    await expect(provider.embed(['x'])).rejects.toThrow(/3 dimensions, above the 2 target/)
  })

  it('throws FatalError on a 404 response', async () => {
    const { fetchFn } = mockFetch(404, { error: 'model not found' })
    const provider = new OllamaEmbeddingProvider({ model: 'missing', fetchFn, sleepFn, dimensions: 2 })
    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(FatalError)
      expect(error.message).toMatch(/404/)
      return true
    })
  })
})

describe('ollamaLLMProvider resilience', () => {
  it('retries 503 (model loading) and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'loading model' } },
      { status: 200, body: { message: { role: 'assistant', content: 'ok' } } },
    ])
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(calls).toHaveLength(2)
    expect(result.message.content).toBe('ok')
  })

  it('throws TransientError when 503 is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'loading model' } },
      { status: 503, body: { error: 'loading model' } },
    ])
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/503/)
      return true
    })
  })

  it('throws FatalError immediately for 400, 401, 402 and 404', async () => {
    for (const status of [400, 401, 402, 404]) {
      const { calls, fetchFn } = sequenceFetch([{ status, body: { error: 'bad' } }])
      const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

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
      { status: 500, body: { error: 'server error' } },
      { status: 200, body: { message: { role: 'assistant', content: 'ok' } } },
    ])
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(calls).toHaveLength(2)
    expect(result.message.content).toBe('ok')
  })

  it('throws TransientError when 5xx is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 500, body: { error: 'server error' } },
      { status: 500, body: { error: 'server error' } },
    ])
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
  })

  it('retries a timed-out fetch and returns the successful response', async () => {
    const fetchFn = timedOutChatFetch(1)
    const provider = new OllamaLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 1, maxAttempts: 2 })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.message.content).toBe('ok')
  })
})

describe('ollamaEmbeddingProvider resilience', () => {
  it('retries 503 (model loading) and returns the successful response', async () => {
    const { calls, fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'loading model' } },
      { status: 200, body: { embeddings: [[0.1, 0.2]] } },
    ])
    const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.embed(['x'])

    expect(calls).toHaveLength(2)
    expect(result).toEqual([[0.1, 0.2]])
  })

  it('throws TransientError when 503 is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 503, body: { error: 'loading model' } },
      { status: 503, body: { error: 'loading model' } },
    ])
    const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/503/)
      return true
    })
  })

  it('throws FatalError immediately for 400, 401, 402 and 404', async () => {
    for (const status of [400, 401, 402, 404]) {
      const { calls, fetchFn } = sequenceFetch([{ status, body: { error: 'bad' } }])
      const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 5000, maxAttempts: 3 })

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
      { status: 500, body: { error: 'server error' } },
      { status: 200, body: { embeddings: [[0.1, 0.2]] } },
    ])
    const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 5000, maxAttempts: 3 })

    const result = await provider.embed(['x'])

    expect(calls).toHaveLength(2)
    expect(result).toEqual([[0.1, 0.2]])
  })

  it('throws TransientError when 5xx is exhausted', async () => {
    const { fetchFn } = sequenceFetch([
      { status: 500, body: { error: 'server error' } },
      { status: 500, body: { error: 'server error' } },
    ])
    const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
  })

  it('retries a timed-out fetch and returns the successful response', async () => {
    const fetchFn = timedOutEmbedFetch(1)
    const provider = new OllamaEmbeddingProvider({ model: 'm', fetchFn, sleepFn, dimensions: 2, timeoutMs: 1, maxAttempts: 2 })

    const result = await provider.embed(['x'])

    expect(result).toEqual([[0.1, 0.2]])
  })
})
