import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamChunk,
  EmbeddingProvider,
  LLMProvider,
} from '../../server/lib/ai/types'
import type { TraceOptions } from '../../server/lib/observability/traced-provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendGeneration } from '../../server/lib/observability/trace-writer'
import { TracedEmbeddingProvider, TracedLLMProvider } from '../../server/lib/observability/traced-provider'

vi.mock('../../server/lib/observability/trace-writer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/lib/observability/trace-writer')>()
  return {
    ...original,
    appendGeneration: vi.fn(original.appendGeneration),
  }
})

const mockedAppendGeneration = vi.mocked(appendGeneration)

function createMockDb(): Kysely<Database> {
  return {} as Kysely<Database>
}

function createTraceOptions(seq = 1): TraceOptions {
  return {
    traceId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    useCase: 'agent',
    seq,
  }
}

function drainWrites() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('tracedLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records a generation for a non-streaming completion', async () => {
    const request: CompletionRequest = {
      messages: [{ role: 'user', content: 'hello' }],
    }
    const result: CompletionResult = {
      message: { role: 'assistant', content: 'hi' },
      model: 'test-model',
      usage: { promptTokens: 5, completionTokens: 2, cost: 0.0001 },
    }
    const fake: LLMProvider = {
      async complete(req) {
        expect(req).toBe(request)
        return result
      },
    }
    const trace = createTraceOptions()
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'test-model', llmUseCase: 'agent' })

    const actual = await traced.complete(request, trace)

    expect(actual).toBe(result)
    await drainWrites()
    expect(mockedAppendGeneration).toHaveBeenCalledTimes(1)
    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.traceId).toBe(trace.traceId)
    expect(call.workspaceId).toBe(trace.workspaceId)
    expect(call.seq).toBe(trace.seq)
    expect(call.llmUseCase).toBe('agent')
    expect(call.provider).toBe('openrouter')
    expect(call.model).toBe('test-model')
    expect(call.prompt).toEqual(request.messages)
    expect(call.response).toEqual(result.message)
    expect(call.promptTokens).toBe(5)
    expect(call.completionTokens).toBe(2)
    expect(call.costUsd).toBe('0.0001')
    expect(call.usageMissing).toBe(false)
  })

  it('sets cost to 0 for ollama', async () => {
    const fake: LLMProvider = {
      async complete() {
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 1, completionTokens: 1 },
        }
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'ollama', model: 'gemma3:4b', llmUseCase: 'agent' })

    await traced.complete({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.costUsd).toBe('0')
  })

  it('marks usage missing when the provider omits usage', async () => {
    const fake: LLMProvider = {
      async complete() {
        return { message: { role: 'assistant', content: 'ok' } }
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    await traced.complete({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.promptTokens).toBeNull()
    expect(call.completionTokens).toBeNull()
    expect(call.costUsd).toBeNull()
    expect(call.usageMissing).toBe(true)
  })

  it('flags usage missing when tokens are present but cost is absent for a paid provider', async () => {
    const fake: LLMProvider = {
      async complete() {
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 5, completionTokens: 2 },
        }
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    await traced.complete({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.promptTokens).toBe(5)
    expect(call.completionTokens).toBe(2)
    expect(call.costUsd).toBeNull()
    expect(call.usageMissing).toBe(true)
  })

  it('records the error and still throws when the provider fails', async () => {
    const fake: LLMProvider = {
      async complete() {
        throw new Error('provider down')
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    await expect(traced.complete({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())).rejects.toThrow('provider down')
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.error).toBe('provider down')
    expect(call.usageMissing).toBe(true)
  })

  it('does not break the LLM call when tracing fails', async () => {
    mockedAppendGeneration.mockRejectedValue(new Error('db down'))
    const fake: LLMProvider = {
      async complete() {
        return { message: { role: 'assistant', content: 'ok' } }
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    const result = await traced.complete({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())
    await drainWrites()

    expect(result.message.content).toBe('ok')
    expect(mockedAppendGeneration).toHaveBeenCalledTimes(1)
  })

  it('accumulates streaming chunks into one generation', async () => {
    const chunks: CompletionStreamChunk[] = [
      { delta: 'hello' },
      { delta: ' ' },
      { delta: 'world', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 3, cost: 0.0002 } },
    ]
    const fake: LLMProvider = {
      async complete() {
        throw new Error('should not be called')
      },
      async* completeStream() {
        for (const chunk of chunks)
          yield chunk
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    const emitted: CompletionStreamChunk[] = []
    for await (const chunk of traced.completeStream({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions())) {
      emitted.push(chunk)
    }
    await drainWrites()

    expect(emitted).toEqual(chunks)
    expect(mockedAppendGeneration).toHaveBeenCalledTimes(1)
    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.response).toEqual({ content: 'hello world', finishReason: 'stop' })
    expect(call.promptTokens).toBe(3)
    expect(call.completionTokens).toBe(3)
    expect(call.costUsd).toBe('0.0002')
    expect(call.finishReason).toBe('stop')
  })

  it('records stream errors with a partial response', async () => {
    const fake: LLMProvider = {
      async* completeStream() {
        yield { delta: 'part' }
        throw new Error('stream broken')
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    await expect(async () => {
      const chunks: CompletionStreamChunk[] = []
      for await (const chunk of traced.completeStream({ messages: [{ role: 'user', content: 'hi' }] }, createTraceOptions()))
        chunks.push(chunk)
    }).rejects.toThrow('stream broken')
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.response).toEqual({ content: 'part', finishReason: null })
    expect(call.error).toBe('stream broken')
  })

  it('passes through without tracing when no trace option is provided', async () => {
    const fake: LLMProvider = {
      async complete() {
        return { message: { role: 'assistant', content: 'ok' } }
      },
    }
    const traced = new TracedLLMProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'm', llmUseCase: 'agent' })

    await traced.complete({ messages: [{ role: 'user', content: 'hi' }] })
    await drainWrites()

    expect(mockedAppendGeneration).not.toHaveBeenCalled()
  })
})

describe('tracedEmbeddingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records metadata-only for embeddings with prompt null', async () => {
    const fake: EmbeddingProvider = {
      async embedWithUsage(texts) {
        return {
          embeddings: texts.map(() => [0.1, 0.2]),
          usage: { promptTokens: 10, totalTokens: 10, cost: 0.00005 },
        }
      },
      async embed() {
        throw new Error('should not be called')
      },
    }
    const traced = new TracedEmbeddingProvider(fake, { db: createMockDb(), provider: 'openrouter', model: 'embed-model', llmUseCase: 'embedding' })

    const result = await traced.embed(['first', 'second'], createTraceOptions())
    await drainWrites()

    expect(result).toEqual([[0.1, 0.2], [0.1, 0.2]])
    expect(mockedAppendGeneration).toHaveBeenCalledTimes(1)
    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.prompt).toBeNull()
    expect(call.promptTokens).toBe(10)
    expect(call.completionTokens).toBe(10)
    expect(call.costUsd).toBe('0.00005')
  })

  it('falls back to embed and records missing usage when no embedWithUsage is provided', async () => {
    const fake: EmbeddingProvider = {
      async embed(texts) {
        return texts.map(() => [0.3])
      },
    }
    const traced = new TracedEmbeddingProvider(fake, { db: createMockDb(), provider: 'ollama', model: 'nomic-embed-text', llmUseCase: 'embedding' })

    await traced.embed(['x'], createTraceOptions())
    await drainWrites()

    const call = mockedAppendGeneration.mock.calls[0]![1]
    expect(call.prompt).toBeNull()
    expect(call.promptTokens).toBeNull()
    expect(call.completionTokens).toBeNull()
    expect(call.costUsd).toBe('0')
    expect(call.usageMissing).toBe(true)
  })
})
