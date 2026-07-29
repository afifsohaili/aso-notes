import type { LLMProvider } from '../../ai/types'
import type { PipelineContext } from '../context'
import type { PipelineDb, Stage } from '../types'
import type { EmbeddedChunk, Vocabulary, VocabularyStrategy } from '../vocabulary/types'
import { resolveVocabularyStrategy } from '../../settings'
import {
  buildExtractionMessages,
  EXTRACTION_SCHEMA,
  EXTRACTION_SCHEMA_NAME,
  parseExtraction,
} from '../extraction'
import { EXTRACT_GRAPH_STAGE } from '../ids'

/**
 * Resolver that selects the vocabulary strategy for a workspace. The default
 * reads `extraction.vocabulary_strategy` from workspace_settings and falls
 * back to the code default.
 */
export type VocabularyStrategyResolver = (db: PipelineDb, workspaceId: string) => Promise<VocabularyStrategy>

/**
 * Whole-note structured extraction (plan §extract-graph): one LLM call with a
 * json_schema response format returning topics, concepts, relations, chunk-level
 * mentions, and suggested tags. The result lands on ctx.extraction; nothing
 * persists until store-graph.
 */
export class ExtractGraphStage implements Stage {
  readonly id = EXTRACT_GRAPH_STAGE

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly resolveStrategy: VocabularyStrategyResolver = resolveVocabularyStrategy,
  ) {}

  async invoke(ctx: PipelineContext): Promise<void> {
    const strategy = await this.resolveStrategy(ctx.db, ctx.workspaceId)
    const vocabulary = await strategy.loadVocabulary(ctx.db, ctx.workspaceId, this.embeddedChunks(ctx))

    ctx.vocabularyStrategy = { id: strategy.id, mergeOnStore: strategy.mergeOnStore }
    ctx.existingTopics = vocabulary.topics

    const chunks = ctx.chunks ?? []

    const result = await this.llmProvider.complete({
      messages: buildExtractionMessages({
        noteTitle: ctx.note.title,
        notePath: ctx.note.path,
        coverChain: ctx.coverChain,
        chunks,
        existingConcepts: vocabulary.concepts,
        existingTags: vocabulary.tags,
        existingTopics: vocabulary.topics,
        strategyLabel: strategy.id === 'full' ? undefined : 'top relevant',
      }),
      responseFormat: {
        type: 'json_schema',
        jsonSchema: { name: EXTRACTION_SCHEMA_NAME, schema: EXTRACTION_SCHEMA, strict: true },
      },
    })

    const content = result.message.content
    if (!content)
      throw new Error('extract-graph: LLM returned no content')

    ctx.extraction = parseExtraction(content, chunks.length)
  }

  private embeddedChunks(ctx: PipelineContext): EmbeddedChunk[] {
    if (ctx.embeddedChunks && ctx.embeddedChunks.length > 0)
      return ctx.embeddedChunks
    return (ctx.chunks ?? []).filter((c): c is EmbeddedChunk => Array.isArray(c.embedding))
  }
}

/**
 * Backwards-compatible vocabulary loader that ignores the embedded-chunks input.
 * Useful for tests and callers that only care about the full workspace vocab.
 */
export function vocabularyLoaderToStrategy(
  loadVocabulary: (db: PipelineDb, workspaceId: string) => Promise<Vocabulary>,
): VocabularyStrategy {
  return {
    id: 'test-loader',
    async loadVocabulary(db, workspaceId) {
      return loadVocabulary(db, workspaceId)
    },
    mergeOnStore: false,
  }
}
