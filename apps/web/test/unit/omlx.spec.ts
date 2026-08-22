import { describe, expect, it } from 'vitest'
import { OmlxEmbeddingProvider, OmlxLLMProvider } from '../../server/lib/ai/omlx'
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

async function sleepFn() {}

describe('omlxLLMProvider', () => {
  it('posts to /chat/completions with OpenAI wire format and maps content + usage', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{
        message: { role: 'assistant', content: 'hello back' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    })
    const provider = new OmlxLLMProvider({ model: 'mlx-community/llama-3.2-3b', fetchFn })

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(calls[0]!.url).toBe('http://localhost:8000/v1/chat/completions')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe('mlx-community/llama-3.2-3b')
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])

    expect(result.message.content).toBe('hello back')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 7 })
    expect(result.finishReason).toBe('stop')
  })

  it('sends no Authorization header', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('maps tools, tool_choice, maxTokens and temperature to the wire format', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_notes', description: 'search', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      maxTokens: 500,
      temperature: 0.2,
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'search_notes', description: 'search', parameters: { type: 'object' } } }])
    expect(body.tool_choice).toBe('auto')
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.2)
  })

  it('maps json_object response format to the OpenAI wire shape', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      responseFormat: { type: 'json_object' },
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('maps json_schema response format to the OpenAI wire shape', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '{"concepts":[]}' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [{ role: 'user', content: 'extract' }],
      responseFormat: { type: 'json_schema', jsonSchema: { name: 'extraction', schema: { type: 'object' }, strict: true } },
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'extraction', schema: { type: 'object' }, strict: true },
    })
  })

  it('maps assistant toolCalls to tool_calls with id/type/function and parses tool_calls back', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_notes', arguments: '{"q":"rag"}' } }],
        },
      }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    const result = await provider.complete({
      messages: [
        { role: 'user', content: 'find' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'call_0', name: 'search_notes', arguments: '{"q":"x"}' }] },
        { role: 'tool', content: '[]', toolCallId: 'call_0' },
      ],
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.messages[1].tool_calls).toEqual([{ id: 'call_0', type: 'function', function: { name: 'search_notes', arguments: '{"q":"x"}' } }])
    expect(body.messages[2]).toEqual({ role: 'tool', content: '[]', tool_call_id: 'call_0' })

    expect(result.message.toolCalls).toEqual([{ id: 'call_1', name: 'search_notes', arguments: '{"q":"rag"}' }])
  })

  it('honours a custom baseUrl and throws TransientError on a 5xx response', async () => {
    const { calls, fetchFn } = mockFetch(500, { error: 'boom' })
    const provider = new OmlxLLMProvider({ model: 'm', baseUrl: 'http://192.168.1.5:8000/v1', fetchFn, sleepFn })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/500/)
      return true
    })
    expect(calls[0]!.url).toBe('http://192.168.1.5:8000/v1/chat/completions')
  })

  it('rejects a response with no choices', async () => {
    const { fetchFn } = mockFetch(200, { choices: [] })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/no choices/)
  })

  it('leaves usage undefined when the response omits a usage block', async () => {
    const { fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.usage).toBeUndefined()
  })

  it('passes tool_choice none through unchanged with tools still sent', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn })

    await provider.complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_notes', description: 'search', parameters: { type: 'object' } }],
      toolChoice: 'none',
    })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'search_notes', description: 'search', parameters: { type: 'object' } } }])
    expect(body.tool_choice).toBe('none')
  })

  it('throws FatalError immediately on 400 and 404', async () => {
    for (const status of [400, 404]) {
      const { calls, fetchFn } = mockFetch(status, { error: 'bad' })
      const provider = new OmlxLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 3 })

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
        expect(error).toBeInstanceOf(FatalError)
        expect(error.message).toMatch(new RegExp(String(status)))
        return true
      })
      expect(calls).toHaveLength(1)
    }
  })
})

describe('omlxLLMProvider resilience', () => {
  it('retries 503 and returns the successful response', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    })
    let attempt = 0
    const provider = new OmlxLLMProvider({
      model: 'm',
      fetchFn: (async (url: any, init: any) => {
        attempt++
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: 'loading model' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return fetchFn(url, init)
      }) as typeof fetch,
      sleepFn,
      timeoutMs: 5000,
      maxAttempts: 3,
    })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(attempt).toBe(2)
    expect(calls).toHaveLength(1)
    expect(result.message.content).toBe('ok')
  })

  it('throws TransientError when 5xx is exhausted', async () => {
    const { fetchFn } = mockFetch(503, { error: 'loading model' })
    const provider = new OmlxLLMProvider({ model: 'm', fetchFn, sleepFn, timeoutMs: 5000, maxAttempts: 2 })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(TransientError)
      expect(error.message).toMatch(/503/)
      return true
    })
  })
})

describe('omlxEmbeddingProvider', () => {
  it('posts to /embeddings with encoding_format float and returns embeddings in order', async () => {
    const { calls, fetchFn } = mockFetch(200, {
      data: [
        { index: 1, embedding: [0.2, 0.2] },
        { index: 0, embedding: [0.1, 0.1] },
      ],
    })
    const provider = new OmlxEmbeddingProvider({ model: 'mlx-community/all-MiniLM-L6-v2', fetchFn, dimensions: 2 })

    const result = await provider.embed(['a', 'b'])

    expect(calls[0]!.url).toBe('http://localhost:8000/v1/embeddings')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toEqual({ model: 'mlx-community/all-MiniLM-L6-v2', input: ['a', 'b'], encoding_format: 'float' })
    expect(result).toEqual([[0.1, 0.1], [0.2, 0.2]])
  })

  it('does not send a dimensions param', async () => {
    const { calls, fetchFn } = mockFetch(200, { data: [{ index: 0, embedding: [0.1] }] })
    const provider = new OmlxEmbeddingProvider({ model: 'm', fetchFn, dimensions: 2 })

    await provider.embed(['x'])

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.dimensions).toBeUndefined()
  })

  it('zero-pads embeddings shorter than the target dimensions', async () => {
    const { fetchFn } = mockFetch(200, { data: [{ index: 0, embedding: [0.5, -0.5] }] })
    const provider = new OmlxEmbeddingProvider({ model: 'm', fetchFn, dimensions: 4 })

    const result = await provider.embed(['x'])

    expect(result).toEqual([[0.5, -0.5, 0, 0]])
  })

  it('zero-pads a 768-dim embedding to the graph-store width of 2048 by default', async () => {
    const { fetchFn } = mockFetch(200, { data: [{ index: 0, embedding: Array.from({ length: 768 }).fill(0.1) }] })
    const provider = new OmlxEmbeddingProvider({ model: 'm', fetchFn })

    const result = await provider.embed(['x'])

    expect(result[0]).toHaveLength(2048)
    expect(result[0]!.slice(0, 768)).toEqual(Array.from({ length: 768 }).fill(0.1))
    expect(result[0]!.slice(768)).toEqual(Array.from({ length: 1280 }).fill(0))
  })

  it('throws when the model returns more dimensions than the target', async () => {
    const { fetchFn } = mockFetch(200, { data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })
    const provider = new OmlxEmbeddingProvider({ model: 'm', fetchFn, dimensions: 2 })

    await expect(provider.embed(['x'])).rejects.toThrow(/3 dimensions, above the 2 target/)
  })

  it('returns an empty array for an empty data payload', async () => {
    const { fetchFn } = mockFetch(200, { data: [] })
    const provider = new OmlxEmbeddingProvider({ model: 'm', fetchFn })

    const result = await provider.embed(['x'])

    expect(result).toEqual([])
  })

  it('throws FatalError on a 404 response', async () => {
    const { fetchFn } = mockFetch(404, { error: 'model not found' })
    const provider = new OmlxEmbeddingProvider({ model: 'missing', fetchFn, sleepFn, dimensions: 2 })
    await expect(provider.embed(['x'])).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(FatalError)
      expect(error.message).toMatch(/404/)
      return true
    })
  })
})
