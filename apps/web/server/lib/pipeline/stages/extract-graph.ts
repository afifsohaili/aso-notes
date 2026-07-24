import type { LLMProvider } from '../../ai/types'
import type { PipelineContext } from '../context'
import type { PipelineDb, Stage } from '../types'
import {
  buildExtractionMessages,
  EXTRACTION_SCHEMA,
  EXTRACTION_SCHEMA_NAME,
  parseExtraction,
} from '../extraction'
import { EXTRACT_GRAPH_STAGE } from '../ids'

export interface ExtractionVocabulary {
  concepts: { name: string, description: string | null }[]
  tags: string[]
}

export type VocabularyLoader = (db: PipelineDb, workspaceId: string) => Promise<ExtractionVocabulary>

/**
 * Default vocabulary: the workspace's full existing concept list (name +
 * description, for dedup) and tag names (vocabulary hints) — plan
 * §extract-graph.
 */
export const loadExtractionVocabulary: VocabularyLoader = async (db, workspaceId) => {
  const [concepts, tags] = await Promise.all([
    db
      .selectFrom('concepts')
      .select(['name', 'description'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('name')
      .execute(),
    db
      .selectFrom('tags')
      .select('name')
      .where('workspace_id', '=', workspaceId)
      .orderBy('name')
      .execute(),
  ])
  return { concepts, tags: tags.map(t => t.name) }
}

/**
 * Whole-note structured extraction (plan §extract-graph): one LLM call with a
 * json_schema response format returning concepts, relations, chunk-level
 * mentions, and suggested tags. The result lands on ctx.extraction; nothing
 * persists until store-graph.
 */
export class ExtractGraphStage implements Stage {
  readonly id = EXTRACT_GRAPH_STAGE

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly loadVocabulary: VocabularyLoader = loadExtractionVocabulary,
  ) {}

  async invoke(ctx: PipelineContext): Promise<void> {
    const vocabulary = await this.loadVocabulary(ctx.db, ctx.workspaceId)
    const chunks = ctx.chunks ?? []

    const result = await this.llmProvider.complete({
      messages: buildExtractionMessages({
        noteTitle: ctx.note.title,
        notePath: ctx.note.path,
        coverChain: ctx.coverChain,
        chunks,
        existingConcepts: vocabulary.concepts,
        existingTags: vocabulary.tags,
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
}
