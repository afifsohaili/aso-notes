/**
 * AI provider strategy interfaces (plan-002-system §Locked tech choices).
 * Chat, embedding, and extraction all sit behind contracts; OpenRouter is
 * the first implementation. M4 (extraction) and M5 (agent) consume these.
 */

/**
 * Embedding width of the graph store (chunks/concepts/topics halfvec columns).
 * Providers must return exactly this many dimensions.
 */
export const EMBEDDING_DIMENSIONS = 2048

export interface EmbeddingResult {
  embeddings: number[][]
  usage?: {
    promptTokens: number
    totalTokens: number
    cost?: number
  }
}

export interface EmbeddingProvider {
  /**
   * Embed a batch of texts. Returns one embedding per input, in input
   * order. Callers validate dimensionality (2048 for the locked model).
   */
  embed: (texts: string[]) => Promise<number[][]>
  /**
   * Embed with usage metadata when the provider reports it. Tracing uses this
   * so the standard `embed` contract stays unchanged for existing callers.
   */
  embedWithUsage?: (texts: string[]) => Promise<EmbeddingResult>
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
  /** Model that produced this completion, when known by the provider. */
  model?: string
  /** Reason the model stopped, when reported by the provider. */
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    /** Cost in USD credits, when reported by the provider (OpenRouter). */
    cost?: number
  }
}

export interface CompletionStreamChunk {
  /** Text delta for the assistant message. */
  delta: string
  /** Present on the last chunk when the model stops or is interrupted. */
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    cost?: number
  }
}

export interface TraceOptions {
  traceId: string
  workspaceId: string
  useCase: string
  seq: number
}

export interface LLMProvider {
  complete: (request: CompletionRequest, trace?: TraceOptions) => Promise<CompletionResult>
  /** Streaming variant; callers and decorators that support it accumulate chunks. */
  completeStream?: (request: CompletionRequest, trace?: TraceOptions) => AsyncIterableIterator<CompletionStreamChunk>
}
