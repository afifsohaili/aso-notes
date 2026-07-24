import type { EmbeddingProvider } from '../ai/types'
import { createEmbeddingProviderFromEnv } from '../ai'
import {
  CHUNK_MARKDOWN_AWARE_STAGE,
  EMBED_CHUNKS_STAGE,
  EXTRACT_GRAPH_STAGE,
  EXTRACT_LINKS_STAGE,
  EXTRACT_SOURCES_STAGE,
  PIPELINES,
  RESOLVE_COVERS_STAGE,
  STORE_GRAPH_STAGE,
} from './ids'
import { StageRegistry, validatePipelines } from './registry'
import { ChunkMarkdownAwareStage } from './stages/chunk-markdown-aware'
import { EmbedChunksStage } from './stages/embed-chunks'
import { ExtractGraphStage } from './stages/extract-graph'
import { ExtractLinksStage } from './stages/extract-links'
import { ExtractSourcesStage } from './stages/extract-sources'
import { ResolveCoversStage } from './stages/resolve-covers'
import { StoreGraphStage } from './stages/store-graph'

export interface StageDeps {
  embeddingProvider: EmbeddingProvider
}

let singleton: StageRegistry | null = null

/**
 * Build the stage registry with constructor-injected deps and validate every
 * pipeline against it (boot-time validation — a bad stage id fails at boot,
 * not mid-ingestion).
 */
export function createStageRegistry(deps: StageDeps): StageRegistry {
  const registry = new StageRegistry()
  registry.register(new ResolveCoversStage())
  registry.register(new ChunkMarkdownAwareStage())
  registry.register(new EmbedChunksStage(deps.embeddingProvider))
  registry.register(new ExtractGraphStage())
  registry.register(new ExtractLinksStage())
  registry.register(new ExtractSourcesStage())
  registry.register(new StoreGraphStage())
  validatePipelines(registry, PIPELINES)
  return registry
}

/**
 * Lazily-built process-wide registry. The embedding provider is constructed
 * from runtime config on first use so importing this module is side-effect
 * free (unit tests never call this — they inject their own registry).
 */
export function getStageRegistry(): StageRegistry {
  if (!singleton)
    singleton = createStageRegistry({ embeddingProvider: createEmbeddingProviderFromEnv() })
  return singleton
}

export {
  CHUNK_MARKDOWN_AWARE_STAGE,
  EMBED_CHUNKS_STAGE,
  EXTRACT_GRAPH_STAGE,
  EXTRACT_LINKS_STAGE,
  EXTRACT_SOURCES_STAGE,
  PIPELINES,
  RESOLVE_COVERS_STAGE,
  STORE_GRAPH_STAGE,
}
