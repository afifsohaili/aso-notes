import type { ResilientFetchOptions } from './resilient-fetch'
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  EmbeddingProvider,
  LLMProvider,
  ResponseFormat,
} from './types'
import { DEFAULT_RESILIENCE, resilientFetch } from './resilient-fetch'
import { EMBEDDING_DIMENSIONS } from './types'

export const OLLAMA_BASE_URL = 'http://localhost:11434'

export interface OllamaOptions {
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

export interface OllamaEmbeddingOptions extends OllamaOptions {
  /**
   * Target embedding length. Sent to Ollama as the `dimensions` body param
   * (Matryoshka models truncate server-side); short results are zero-padded,
   * longer results are an error. Defaults to the graph store width.
   */
  dimensions?: number
}

interface OllamaToolCallWire {
  function: { name: string, arguments: Record<string, unknown> }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content }
  if (message.toolCalls) {
    // Ollama native: arguments are an object, no ids
    wire.tool_calls = message.toolCalls.map(call => ({
      function: { name: call.name, arguments: JSON.parse(call.arguments) },
    }))
  }
  return wire
}

function toWireFormat(format: ResponseFormat): unknown {
  if (format.type === 'json_object')
    return 'json'
  return format.jsonSchema.schema
}

interface OllamaChatResponse {
  message: {
    role: string
    content: string | null
    tool_calls?: OllamaToolCallWire[]
  }
  prompt_eval_count?: number
  eval_count?: number
}

export class OllamaLLMProvider implements LLMProvider {
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(options: OllamaOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
    this.sleepFn = options.sleepFn ?? (async (_ms: number) => {})
    this.resilience = {
      timeoutMs: options.timeoutMs ?? DEFAULT_RESILIENCE.timeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RESILIENCE.baseDelayMs,
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map(toWireMessage),
      stream: false,
      options: {} as Record<string, unknown>,
    }
    const options = body.options as Record<string, unknown>

    // Ollama has no tool_choice param: 'none' ≈ omit tools entirely
    if (request.tools && request.toolChoice !== 'none') {
      body.tools = request.tools.map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
    if (request.responseFormat)
      body.format = toWireFormat(request.responseFormat)
    if (request.maxTokens !== undefined)
      options.num_predict = request.maxTokens
    if (request.temperature !== undefined)
      options.temperature = request.temperature
    if (Object.keys(options).length === 0)
      delete body.options

    const response = await resilientFetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })

    const payload = await response.json() as OllamaChatResponse
    if (!payload.message)
      throw new Error('Ollama /api/chat response contained no message')

    return {
      model: this.model,
      message: {
        role: 'assistant',
        content: payload.message.content,
        ...(payload.message.tool_calls
          ? {
              toolCalls: payload.message.tool_calls.map(call => ({
                // Ollama assigns no ids — the agent loop only needs them locally
                id: crypto.randomUUID(),
                name: call.function.name,
                arguments: JSON.stringify(call.function.arguments),
              })),
            }
          : {}),
      },
      ...(payload.prompt_eval_count !== undefined || payload.eval_count !== undefined
        ? {
            usage: {
              promptTokens: payload.prompt_eval_count ?? 0,
              completionTokens: payload.eval_count ?? 0,
            },
          }
        : {}),
    }
  }
}

interface OllamaEmbedResponse {
  embeddings: number[][]
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly dimensions: number

  constructor(options: OllamaEmbeddingOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL
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
    const response = await resilientFetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })

    const payload = await response.json() as OllamaEmbedResponse
    return payload.embeddings.map(embedding => this.fitDimensions(embedding))
  }

  private fitDimensions(embedding: number[]): number[] {
    if (embedding.length === this.dimensions)
      return embedding
    if (embedding.length > this.dimensions) {
      throw new Error(
        `Ollama model ${this.model} returned ${embedding.length} dimensions, above the ${this.dimensions} target — pick a smaller model or widen the graph store`,
      )
    }
    const result = [...embedding]
    while (result.length < this.dimensions)
      result.push(0)
    return result
  }
}
