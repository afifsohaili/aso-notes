import type { PipelineId, StageId } from './types'

/** Stage-ID string constants — the single source of truth for stage naming. */
export const RESOLVE_COVERS_STAGE: StageId = 'resolve-covers'
export const CHUNK_MARKDOWN_AWARE_STAGE: StageId = 'chunk-markdown-aware'
export const EMBED_CHUNKS_STAGE: StageId = 'embed-chunks'
export const EXTRACT_GRAPH_STAGE: StageId = 'extract-graph'
export const EXTRACT_LINKS_STAGE: StageId = 'extract-links'
export const EXTRACT_SOURCES_STAGE: StageId = 'extract-sources'
export const STORE_GRAPH_STAGE: StageId = 'store-graph'

/** Pipeline-ID string constants. */
export const MARKDOWN_NOTE_PIPELINE: PipelineId = 'markdown-note'
export const MARKDOWN_NOTE_WITH_LINKS_PIPELINE: PipelineId = 'markdown-note-with-links'

/**
 * Pipeline definitions (plan-002-system §Ingestion pipeline). The default
 * `markdown-note` pipeline's extract-graph stage covers concepts/relations/
 * mentions/tags; `markdown-note-with-links` additionally extracts wikilinks
 * and external sources.
 */
export const PIPELINES: Record<PipelineId, StageId[]> = {
  [MARKDOWN_NOTE_PIPELINE]: [
    RESOLVE_COVERS_STAGE,
    CHUNK_MARKDOWN_AWARE_STAGE,
    EMBED_CHUNKS_STAGE,
    EXTRACT_GRAPH_STAGE,
    STORE_GRAPH_STAGE,
  ],
  [MARKDOWN_NOTE_WITH_LINKS_PIPELINE]: [
    RESOLVE_COVERS_STAGE,
    CHUNK_MARKDOWN_AWARE_STAGE,
    EMBED_CHUNKS_STAGE,
    EXTRACT_GRAPH_STAGE,
    EXTRACT_LINKS_STAGE,
    EXTRACT_SOURCES_STAGE,
    STORE_GRAPH_STAGE,
  ],
}
