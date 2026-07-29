import type { EmbeddingProvider } from './types'
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
}

interface EmbeddingsResponse {
  data: { index: number, embedding: number[] }[]
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch

  constructor(options: OpenRouterEmbeddingOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
    this.fetchFn = options.fetchFn ?? fetch
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.fetchFn(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenRouter embeddings request failed (${response.status}): ${body}`)
    }
    const payload = await response.json() as EmbeddingsResponse
    return payload.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.embedding)
  }
}
