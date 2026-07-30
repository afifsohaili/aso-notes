import type { EmbeddingProvider, LLMProvider } from '../ai/types'
import type { PipelineDb } from './types'
import process from 'node:process'
import { createEmbeddingProvider, createLLMProvider, resolveEmbeddingProvider, resolveLLMProvider } from '../ai/registry'
import { resolveEmbeddingProviderSettings, resolveLLMProviderSettings } from '../settings'
import { resolveSyncWorkspace } from '../sync/workspace'
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
  llmProvider: LLMProvider
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
  registry.register(new ExtractGraphStage(deps.llmProvider))
  registry.register(new ExtractLinksStage())
  registry.register(new ExtractSourcesStage())
  registry.register(new StoreGraphStage(deps.embeddingProvider))
  validatePipelines(registry, PIPELINES)
  return registry
}

async function createWorkspaceStageRegistry(db?: PipelineDb): Promise<StageRegistry> {
  if (db) {
    const workspaceId = await resolveSyncWorkspace(db)
    if (workspaceId) {
      const llmSettings = await resolveLLMProviderSettings(db, workspaceId, 'extraction', process.env)
      const embeddingSettings = await resolveEmbeddingProviderSettings(db, workspaceId, process.env)
      return createStageRegistry({
        llmProvider: resolveLLMProvider('extraction', process.env, llmSettings).provider,
        embeddingProvider: resolveEmbeddingProvider(process.env, embeddingSettings).provider,
      })
    }
  }

  return createStageRegistry({
    embeddingProvider: createEmbeddingProvider(process.env).provider,
    llmProvider: createLLMProvider('extraction', process.env).provider,
  })
}

/**
 * Lazily-built process-wide registry. When a DB is supplied, the providers are
 * resolved from workspace_settings → env → code default for the single-tenant
 * MVP workspace. Without a DB, env-only resolution is used (tests / legacy).
 *
 * Call `clearStageRegistry()` after any `llm.*` setting changes so the next use
 * re-resolves the providers.
 */
export async function getStageRegistry(db?: PipelineDb): Promise<StageRegistry> {
  if (!singleton) {
    singleton = await createWorkspaceStageRegistry(db)
  }
  return singleton
}

/**
 * Discard the cached stage registry. The next call to `getStageRegistry` will
 * re-resolve providers from the current workspace settings and env.
 */
export function clearStageRegistry(): void {
  singleton = null
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
