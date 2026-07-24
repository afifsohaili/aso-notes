/**
 * AI provider strategy interfaces (plan-002-system §Locked tech choices).
 * Chat, embedding, and extraction all sit behind contracts; OpenRouter is
 * the first implementation. M4 (extraction) and M5 (agent) consume these.
 */

export interface EmbeddingProvider {
  /**
   * Embed a batch of texts. Returns one embedding per input, in input
   * order. Callers validate dimensionality (2048 for the locked model).
   */
  embed: (texts: string[]) => Promise<number[][]>
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  /** Provider-assigned id, echoed back in the tool-result message. */
  id: string
  name: string
  /** JSON-encoded argument object (OpenAI wire format). */
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
  /** Present on assistant messages that request tool calls. */
  toolCalls?: ToolCall[]
  /** Present on tool-result messages: the ToolCall.id being answered. */
  toolCallId?: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>
}

export type ResponseFormat
  = | { type: 'json_object' }
    | { type: 'json_schema', jsonSchema: { name: string, schema: Record<string, unknown>, strict?: boolean } }

export interface CompletionRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  /** 'auto' lets the model call tools; 'none' forces a plain completion. */
  toolChoice?: 'auto' | 'none'
  /** Structured-output constraint for extraction-style calls. */
  responseFormat?: ResponseFormat
  maxTokens?: number
  temperature?: number
}

export interface CompletionResult {
  message: ChatMessage
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface LLMProvider {
  complete: (request: CompletionRequest) => Promise<CompletionResult>
}
