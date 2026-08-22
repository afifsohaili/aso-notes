import type { DB } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { ProviderKind } from '../ai/registry'
import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamChunk,
  EmbeddingProvider,
  EmbeddingResult,
  LLMProvider,
  TraceOptions,
} from '../ai/types'
import type { AppendGenerationInput } from './trace-writer'
import { appendGeneration, safeTraceWrite } from './trace-writer'

export type { TraceOptions } from '../ai/types'
export interface TracedProviderDependencies {
  db: Kysely<DB>
  provider: ProviderKind
  model: string
  llmUseCase: string
}

function formatCost(kind: ProviderKind, usage?: { cost?: number }): string | null {
  if (kind === 'ollama' || kind === 'omlx')
    return '0'
  if (usage?.cost !== undefined)
    return String(usage.cost)
  return null
}

function isUsageMissing(kind: ProviderKind, usage?: { cost?: number }): boolean {
  if (usage === undefined)
    return true
  if (kind === 'ollama' || kind === 'omlx')
    return false
  return usage.cost === undefined
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

type RecordGenerationFields = Omit<AppendGenerationInput, 'workspaceId' | 'traceId' | 'seq' | 'llmUseCase' | 'provider' | 'model'>

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted)
    return true
  return error instanceof Error && error.name === 'AbortError'
}

export class TracedLLMProvider implements LLMProvider {
  constructor(
    private readonly provider: LLMProvider,
    private readonly deps: TracedProviderDependencies,
  ) {}

  private recordGeneration(trace: TraceOptions, fields: RecordGenerationFields): void {
    safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
      ...traceFields(trace, this.deps),
      ...fields,
    }))
  }

  async complete(request: CompletionRequest, trace?: TraceOptions, signal?: AbortSignal): Promise<CompletionResult> {
    const start = Date.now()
    let result: CompletionResult
    try {
      result = await this.provider.complete(request, undefined, signal)
    }
    catch (error) {
      if (trace) {
        const latencyMs = Date.now() - start
        const aborted = isAbortError(error, signal)
        this.recordGeneration(trace, {
          prompt: request.messages,
          latencyMs,
          response: null,
          finishReason: aborted ? 'aborted' : null,
          error: error instanceof Error ? error.message : String(error),
          usageMissing: true,
        })
      }
      throw error
    }

    if (trace) {
      const latencyMs = Date.now() - start
      if (signal?.aborted) {
        // Non-streaming providers cannot produce partial text, so we record the
        // generation as aborted with no response.
        this.recordGeneration(trace, {
          prompt: request.messages,
          latencyMs,
          response: null,
          finishReason: 'aborted',
          error: typeof signal.reason === 'string' ? signal.reason : 'Aborted',
          usageMissing: true,
        })
      }
      else {
        this.recordGeneration(trace, {
          prompt: request.messages,
          response: result.message,
          promptTokens: result.usage?.promptTokens ?? null,
          completionTokens: result.usage?.completionTokens ?? null,
          costUsd: formatCost(this.deps.provider, result.usage),
          latencyMs,
          finishReason: result.finishReason ?? null,
          usageMissing: isUsageMissing(this.deps.provider, result.usage),
        })
      }
    }

    return result
  }

  async* completeStream(request: CompletionRequest, trace?: TraceOptions, signal?: AbortSignal): AsyncIterableIterator<CompletionStreamChunk> {
    if (!this.provider.completeStream) {
      throw new Error(
        `Provider ${this.deps.provider}/${this.deps.model} does not support streaming`,
      )
    }

    const start = Date.now()
    const chunks: CompletionStreamChunk[] = []
    let streamError: unknown
    try {
      for await (const chunk of this.provider.completeStream(request, undefined, signal)) {
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
        const aborted = isAbortError(streamError, signal)
        this.recordGeneration(trace, {
          prompt: request.messages,
          response: { content, finishReason: aborted ? 'aborted' : (lastChunk?.finishReason ?? null) },
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          costUsd: formatCost(this.deps.provider, usage),
          latencyMs,
          finishReason: aborted ? 'aborted' : (lastChunk?.finishReason ?? null),
          usageMissing: isUsageMissing(this.deps.provider, usage),
          error: streamError instanceof Error
            ? streamError.message
            : streamError
              ? String(streamError)
              : (aborted ? (typeof signal!.reason === 'string' ? signal!.reason : 'Aborted') : null),
        })
      }
    }
  }
}

export class TracedEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly deps: TracedProviderDependencies,
  ) {}

  private recordGeneration(trace: TraceOptions, fields: RecordGenerationFields): void {
    safeTraceWrite('appendGeneration', () => appendGeneration(this.deps.db, {
      ...traceFields(trace, this.deps),
      ...fields,
    }))
  }

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
        this.recordGeneration(trace, {
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
          usageMissing: true,
        })
      }
      throw error
    }

    if (trace) {
      const latencyMs = Date.now() - start
      this.recordGeneration(trace, {
        prompt: null,
        latencyMs,
        promptTokens: result.usage?.promptTokens ?? null,
        completionTokens: result.usage?.totalTokens ?? null,
        costUsd: formatCost(this.deps.provider, result.usage),
        usageMissing: isUsageMissing(this.deps.provider, result.usage),
      })
    }

    return result.embeddings
  }
}
