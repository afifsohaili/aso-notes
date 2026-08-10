import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamChunk,
  EmbeddingProvider,
  EmbeddingResult,
  LLMProvider,
  ProviderKind,
} from '../ai/types'
import { appendGeneration, safeTraceWrite } from './trace-writer'

export interface TraceOptions {
  traceId: string
  workspaceId: string
  useCase: string
  seq: number
}

export interface TracedProviderDependencies {
  db: Kysely<Database>
  provider: ProviderKind
  model: string
  llmUseCase: string
}

function formatCost(kind: ProviderKind, usage?: { cost?: number }): string | null {
  if (kind === 'ollama')
    return '0'
  if (usage?.cost !== undefined)
    return String(usage.cost)
  return null
}

function traceFields(trace: TraceOptions, deps: TracedProviderDependencies) {
  return {
    workspaceId: trace.workspaceId,
    traceId: trace.traceId,
    seq: trace.seq,
    llmUseCase: trace.useCase,
    provider: deps.provider,
    model: deps.model,
  }
}

export class TracedLLMProvider implements LLMProvider {
  constructor(
    private readonly provider: LLMProvider,
    private readonly deps: TracedProviderDependencies,
  ) {}

  async complete(request: CompletionRequest, trace?: TraceOptions): Promise<CompletionResult> {
    const start = Date.now()
    let result: CompletionResult
    try {
      result = await this.provider.complete(request)
    }
    catch (error) {
      if (trace) {
        const latencyMs = Date.now() - start
        safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
          ...traceFields(trace, this.deps),
          prompt: request.messages,
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
          usageMissing: true,
        }))
      }
      throw error
    }

    if (trace) {
      const latencyMs = Date.now() - start
      safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
        ...traceFields(trace, this.deps),
        prompt: request.messages,
        response: result.message,
        promptTokens: result.usage?.promptTokens ?? null,
        completionTokens: result.usage?.completionTokens ?? null,
        costUsd: formatCost(this.deps.provider, result.usage),
        latencyMs,
        finishReason: result.finishReason ?? null,
        usageMissing: result.usage === undefined,
      }))
    }

    return result
  }

  async* completeStream(request: CompletionRequest, trace?: TraceOptions): AsyncIterableIterator<CompletionStreamChunk> {
    if (!this.provider.completeStream) {
      throw new Error(
        `Provider ${this.deps.provider}/${this.deps.model} does not support streaming`,
      )
    }

    const start = Date.now()
    const chunks: CompletionStreamChunk[] = []
    let streamError: unknown
    try {
      for await (const chunk of this.provider.completeStream(request)) {
        chunks.push(chunk)
        yield chunk
      }
    }
    catch (error) {
      streamError = error
      throw error
    }
    finally {
      if (trace) {
        const latencyMs = Date.now() - start
        const content = chunks.map(c => c.delta).join('')
        const lastChunk = chunks[chunks.length - 1]
        const usage = lastChunk?.usage
        safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
          ...traceFields(trace, this.deps),
          prompt: request.messages,
          response: { content, finishReason: lastChunk?.finishReason ?? null },
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          costUsd: formatCost(this.deps.provider, usage),
          latencyMs,
          finishReason: lastChunk?.finishReason ?? null,
          usageMissing: usage === undefined,
          error: streamError instanceof Error
            ? streamError.message
            : streamError
              ? String(streamError)
              : null,
        }))
      }
    }
  }
}

export class TracedEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly deps: TracedProviderDependencies,
  ) {}

  async embed(texts: string[], trace?: TraceOptions): Promise<number[][]> {
    const start = Date.now()
    let result: EmbeddingResult
    try {
      result = this.provider.embedWithUsage
        ? await this.provider.embedWithUsage(texts)
        : { embeddings: await this.provider.embed(texts) }
    }
    catch (error) {
      if (trace) {
        const latencyMs = Date.now() - start
        safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
          ...traceFields(trace, this.deps),
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
          usageMissing: true,
        }))
      }
      throw error
    }

    if (trace) {
      const latencyMs = Date.now() - start
      safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
        ...traceFields(trace, this.deps),
        prompt: null,
        latencyMs,
        promptTokens: result.usage?.promptTokens ?? null,
        completionTokens: result.usage?.totalTokens ?? null,
        costUsd: formatCost(this.deps.provider, result.usage),
        usageMissing: result.usage === undefined,
      }))
    }

    return result.embeddings
  }
}
