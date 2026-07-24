import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import { EXTRACT_GRAPH_STAGE } from '../ids'

/**
 * M4 placeholder. Will run the whole-note structured extraction call
 * (concepts, relations, mentions) against the LLM provider. Registered as a
 * no-op so the default pipeline validates and runs end-to-end in M2/M3.
 */
export class ExtractGraphStage implements Stage {
  readonly id = EXTRACT_GRAPH_STAGE

  async invoke(_ctx: PipelineContext): Promise<void> {
    // no-op until M4
  }
}
