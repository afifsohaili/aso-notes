import type { ResilientFetchOptions } from './resilient-fetch'
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ResponseFormat,
} from './types'
import { DEFAULT_RESILIENCE, resilientFetch } from './resilient-fetch'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash'

export interface OpenRouterLLMOptions {
  apiKey: string
  model?: string
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

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content }
  if (message.toolCalls) {
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
  }[]
  usage?: { prompt_tokens: number, completion_tokens: number }
}

export class OpenRouterLLMProvider implements LLMProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(options: OpenRouterLLMOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_CHAT_MODEL
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
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
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })

    const payload = await response.json() as ChatCompletionsResponse
    const message = payload.choices[0]?.message
    if (!message)
      throw new Error('OpenRouter chat/completions response contained no choices')

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
    }
  }
}
