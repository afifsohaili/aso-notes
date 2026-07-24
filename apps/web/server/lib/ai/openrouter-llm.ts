import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ResponseFormat,
} from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_CHAT_MODEL = 'deepseek/deepseek-v4-flash'

export interface OpenRouterLLMOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  /** Injectable for tests — no live API calls in the test suite. */
  fetchFn?: typeof fetch
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
  private readonly fetchFn: typeof fetch

  constructor(options: OpenRouterLLMOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_CHAT_MODEL
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
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

    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenRouter chat/completions request failed (${response.status}): ${text}`)
    }

    const payload = await response.json() as ChatCompletionsResponse
    const message = payload.choices[0]?.message
    if (!message)
      throw new Error('OpenRouter chat/completions response contained no choices')

    return {
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
