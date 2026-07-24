import type { PipelineContext } from '../context'
import type { ExtractedSource, Stage } from '../types'
import { EXTRACT_SOURCES_STAGE } from '../ids'
import { deriveSourceType, extractUrls, normalizeUrl } from '../url-normalizer'

/**
 * Extract external URLs from the note's raw markdown into
 * ctx output 'sources' (plan §URL normalization). Dedup key is the
 * normalized URL; the first raw occurrence wins.
 */
export class ExtractSourcesStage implements Stage {
  readonly id = EXTRACT_SOURCES_STAGE

  async invoke(ctx: PipelineContext): Promise<void> {
    const sources: ExtractedSource[] = []
    const seen = new Set<string>()

    for (const url of extractUrls(ctx.note.content ?? '')) {
      const urlNormalized = normalizeUrl(url)
      if (!urlNormalized || seen.has(urlNormalized))
        continue
      seen.add(urlNormalized)
      sources.push({ url, urlNormalized, type: deriveSourceType(url) })
    }

    ctx.setOutput('sources', sources)
  }
}
