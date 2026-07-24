import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import { chunkMarkdown } from '../chunker'
import { CHUNK_MARKDOWN_AWARE_STAGE } from '../ids'

/** Split the note's raw markdown into chunks (plan §chunk-markdown-aware). */
export class ChunkMarkdownAwareStage implements Stage {
  readonly id = CHUNK_MARKDOWN_AWARE_STAGE

  async invoke(ctx: PipelineContext): Promise<void> {
    ctx.chunks = chunkMarkdown(ctx.note.content ?? '')
  }
}
