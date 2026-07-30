import type { ResilientFetchOptions } from './resilient-fetch'
import type { EmbeddingProvider } from './types'
import { DEFAULT_RESILIENCE, resilientFetch } from './resilient-fetch'
import { EMBEDDING_DIMENSIONS } from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free'
/** nvidia/llama-nemotron-embed-vl-1b-v2 outputs 2048-dim embeddings (model card). */
export { EMBEDDING_DIMENSIONS }

export interface OpenRouterEmbeddingOptions {
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

interface EmbeddingsResponse {
  data: { index: number, embedding: number[] }[]
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  readonly resilience: Required<Pick<ResilientFetchOptions, 'timeoutMs' | 'maxAttempts' | 'baseDelayMs'>>
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(options: OpenRouterEmbeddingOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
    this.sleepFn = options.sleepFn ?? (async (_ms: number) => {})
    this.resilience = {
      timeoutMs: options.timeoutMs ?? DEFAULT_RESILIENCE.timeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RESILIENCE.baseDelayMs,
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await resilientFetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    }, {
      ...this.resilience,
      fetchFn: this.fetchFn,
      sleepFn: this.sleepFn,
    })
    const payload = await response.json() as EmbeddingsResponse
    return payload.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.embedding)
  }
}
