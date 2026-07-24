import { describe, expect, it } from 'vitest'
import { OpenRouterEmbeddingProvider } from '../../server/lib/ai/openrouter-embedding'
import { OpenRouterLLMProvider } from '../../server/lib/ai/openrouter-llm'

function mockFetch(status: number, body: unknown) {
  const calls: { url: string, init: RequestInit }[] = []
  const fetchFn = async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchFn: fetchFn as typeof fetch }
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

  it('throws with status and body on a non-OK response', async () => {
    const { fetchFn } = mockFetch(429, { error: { message: 'rate limited' } })
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'sk-test', fetchFn })
    await expect(provider.embed(['x'])).rejects.toThrow(/429.*rate limited|rate limited.*429/)
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

  it('throws with status and body on a non-OK response', async () => {
    const { fetchFn } = mockFetch(401, { error: { message: 'bad key' } })
    const provider = new OpenRouterLLMProvider({ apiKey: 'sk-bad', fetchFn })
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/401/)
  })
})
