import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  EmbeddingProvider,
  LLMProvider,
  ResponseFormat,
} from './types'

export const OLLAMA_BASE_URL = 'http://localhost:11434'

export interface OllamaOptions {
  model: string
  baseUrl?: string
  /** Injectable for tests — no live API calls in the test suite. */
  fetchFn?: typeof fetch
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
  private readonly fetchFn: typeof fetch

  constructor(options: OllamaOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
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

    const response = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama /api/chat request failed (${response.status}): ${text}`)
    }

    const payload = await response.json() as OllamaChatResponse
    if (!payload.message)
      throw new Error('Ollama /api/chat response contained no message')

    return {
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
  private readonly fetchFn: typeof fetch

  constructor(options: OllamaOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl ?? OLLAMA_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.fetchFn(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Ollama /api/embed request failed (${response.status}): ${text}`)
    }

    const payload = await response.json() as OllamaEmbedResponse
    return payload.embeddings
  }
}
