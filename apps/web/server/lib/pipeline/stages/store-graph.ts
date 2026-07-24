import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import { STORE_GRAPH_STAGE } from '../ids'

/**
 * M4 placeholder. Will perform concept resolution, concept embedding, and
 * the final atomic transaction (wipe+rewrite chunks/mentions/links/sources,
 * upsert concepts, insert relations, dedupe ai-tags, AGE mirror, mark
 * ingested). Registered as a no-op so pipelines validate and run in M2/M3.
 */
export class StoreGraphStage implements Stage {
  readonly id = STORE_GRAPH_STAGE

  async invoke(_ctx: PipelineContext): Promise<void> {
    // no-op until M4
  }
}
