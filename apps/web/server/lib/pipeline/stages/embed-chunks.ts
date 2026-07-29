import type { EmbeddingProvider } from '../../ai/types'
import type { PipelineChunk } from '../chunker'
import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import type { EmbeddedChunk } from '../vocabulary/types'
import { EMBEDDING_DIMENSIONS } from '../../ai'
import { EMBED_CHUNKS_STAGE } from '../ids'

const EMBED_BATCH_SIZE = 100

/** Embedding input: merged cover chain + heading path + chunk text (plan §embed-chunks). */
export function buildEmbeddingInput(ctx: PipelineContext, chunk: PipelineChunk): string {
  const parts: string[] = []
  if (ctx.coverChain)
    parts.push(ctx.coverChain)
  if (chunk.headingPath.length > 0)
    parts.push(chunk.headingPath.join(' > '))
  parts.push(chunk.text)
  return parts.join('\n\n')
}

/** Batch-embed all chunks; validates dimensionality of every embedding. */
export class EmbedChunksStage implements Stage {
  readonly id = EMBED_CHUNKS_STAGE

  constructor(private readonly embeddingProvider: EmbeddingProvider) {}

  async invoke(ctx: PipelineContext): Promise<void> {
    const chunks = ctx.chunks ?? []
    if (chunks.length === 0)
      return

    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE)
      const embeddings = await this.embeddingProvider.embed(
        batch.map(chunk => buildEmbeddingInput(ctx, chunk)),
      )
      if (embeddings.length !== batch.length) {
        throw new Error(
          `embedding provider returned ${embeddings.length} embeddings for ${batch.length} inputs`,
        )
      }
      for (let i = 0; i < batch.length; i++) {
        const embedding = embeddings[i]!
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `embedding for chunk ${batch[i]!.index} has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
          )
        }
        batch[i]!.embedding = embedding
      }
    }

    ctx.embeddedChunks = chunks.filter((c): c is EmbeddedChunk => Array.isArray(c.embedding))
  }
}
