import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import { EXTRACT_LINKS_STAGE } from '../ids'

/**
 * M4 placeholder. Will parse wikilinks from raw markdown into ctx outputs;
 * store-graph persists them (links are wiped+rewritten in the store phase,
 * which is M4 scope). Registered as a no-op so the
 * `markdown-note-with-links` pipeline validates at boot.
 */
export class ExtractLinksStage implements Stage {
  readonly id = EXTRACT_LINKS_STAGE

  async invoke(_ctx: PipelineContext): Promise<void> {
    // no-op until M4
  }
}
