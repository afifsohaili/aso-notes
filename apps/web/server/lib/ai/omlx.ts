import type { ResilientFetchOptions } from './resilient-fetch'
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  EmbeddingProvider,
  LLMProvider,
  ResponseFormat,
  TraceOptions,
} from './types'
import { DEFAULT_RESILIENCE, resilientFetch } from './resilient-fetch'
import { EMBEDDING_DIMENSIONS } from './types'

export const OMLX_BASE_URL = 'http://localhost:8000/v1'

export interface OmlxOptions {
  model: string
  baseUrl?: string
  /** Injectable for tests — no live API calls in the test suite. */
  fetchFn?: typeof fetch
  /** Injectable for tests — no real sleeps in the test suite. */
  sleepFn?: (ms: number) => Promise<void>
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum number of attempts (including the first try). */
  maxAttempts?: number
  /** Base delay for exponential backoff with jitter. */
  baseDelayMs?: number
}

export interface OmlxEmbeddingOptions extends OmlxOptions {
  /**
   * Target embedding length. oMLX returns full dims for models that don't
   * support truncation, so short results are zero-padded and longer results
   * are an error. Defaults to the graph store width.
   */
  dimensions?: number
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content }
  if (message.toolCalls) {
    // oMLX serves the OpenAI wire format: tool_calls carry id/type/function
    // with arguments as a JSON string.
    wire.tool_calls = message.toolCalls.map(call => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  if (message.toolCallId)
    wire.tool_call_id = message.toolCallId
  return wire
}

function toWireResponseFormat(format: ResponseFormat): Record<string, unknown> {
  if (format.type === 'json_object')
    return { type: 'json_object' }
  return {
    type: 'json_schema',
    json_schema: {
      name: format.jsonSchema.name,
      schema: format.jsonSchema.schema,
      ...(format.jsonSchema.strict !== undefined ? { strict: format.jsonSchema.strict } : {}),
    },
  }
}

interface ChatCompletionsResponse {
  choices: {
    message: {
      role: string
      content: string | null
      tool_calls?: { id: string, function: { name: string, arguments: string } }[]
    }
    finish_reason?: string
  }[]
  usage?: { prompt_tokens: number, completion_tokens: number }
}

export class OmlxLLMProvider implements LLMProvider {
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(options: OmlxOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OMLX_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
    this.sleepFn = options.sleepFn ?? (async (_ms: number) => {})
    this.resilience = {
      timeoutMs: options.timeoutMs ?? DEFAULT_RESILIENCE.timeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RESILIENCE.baseDelayMs,
    }
  }

  async complete(request: CompletionRequest, _trace?: TraceOptions, signal?: AbortSignal): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map(toWireMessage),
    }
    if (request.tools) {
      body.tools = request.tools.map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
    if (request.toolChoice)
      body.tool_choice = request.toolChoice
    if (request.responseFormat)
      body.response_format = toWireResponseFormat(request.responseFormat)
    if (request.maxTokens !== undefined)
      body.max_tokens = request.maxTokens
    if (request.temperature !== undefined)
      body.temperature = request.temperature

    const response = await resilientFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })

    const payload = await response.json() as ChatCompletionsResponse
    const message = payload.choices[0]?.message
    if (!message)
      throw new Error('oMLX chat/completions response contained no choices')

    return {
      model: this.model,
      message: {
        role: 'assistant',
        content: message.content,
        ...(message.tool_calls
          ? {
              toolCalls: message.tool_calls.map(call => ({
                id: call.id,
                name: call.function.name,
                arguments: call.function.arguments,
              })),
            }
          : {}),
      },
      ...(payload.usage
        ? {
            usage: {
              promptTokens: payload.usage.prompt_tokens,
              completionTokens: payload.usage.completion_tokens,
            },
          }
        : {}),
      finishReason: payload.choices[0]?.finish_reason,
    }
  }
}

interface EmbeddingsResponse {
  data: { index: number, embedding: number[] }[]
}

export class OmlxEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly dimensions: number

  constructor(options: OmlxEmbeddingOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OMLX_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
    this.sleepFn = options.sleepFn ?? (async (_ms: number) => {})
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS
    this.resilience = {
      timeoutMs: options.timeoutMs ?? DEFAULT_RESILIENCE.timeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RESILIENCE.baseDelayMs,
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await resilientFetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No `dimensions` param — oMLX returns full dims for models that don't
      // support truncation; short results are zero-padded instead.
      body: JSON.stringify({ model: this.model, input: texts, encoding_format: 'float' }),
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })

    const payload = await response.json() as EmbeddingsResponse
    return payload.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(entry => this.fitDimensions(entry.embedding))
  }

  private fitDimensions(embedding: number[]): number[] {
    if (embedding.length === this.dimensions)
      return embedding
    if (embedding.length > this.dimensions) {
      throw new Error(
        `oMLX model ${this.model} returned ${embedding.length} dimensions, above the ${this.dimensions} target — pick a smaller model or widen the graph store`,
      )
    }
    const result = [...embedding]
    while (result.length < this.dimensions)
      result.push(0)
    return result
  }
}
