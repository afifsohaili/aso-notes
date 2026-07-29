import type { PipelineChunk } from './chunker'
import type { GraphExtraction, PipelineDb, PipelineNote } from './types'
import type { EmbeddedChunk } from './vocabulary/types'

/**
 * Mutable bag passed through every stage of a pipeline run
 * (plan-002-system §Ingestion pipeline). Stages read inputs from and write
 * outputs to this context; nothing persists until the final store stage.
 */
export class PipelineContext {
  readonly note: PipelineNote
  readonly workspaceId: string
  readonly db: PipelineDb

  /** Merged folder-cover chain, root→leaf, joined with blank lines. */
  coverChain?: string
  chunks?: PipelineChunk[]
  /** Chunks after embedding by embed-chunks; available to downstream stages. */
  embeddedChunks?: EmbeddedChunk[]
  extraction?: GraphExtraction
  /** Vocabulary strategy resolved for this workspace; consumed by store-graph (M3). */
  vocabularyStrategy?: { id: string, mergeOnStore: boolean }
  /** Existing topics loaded for extraction; consumed by store-graph (M3). */
  existingTopics?: { id: string, name: string, description: string | null }[]
  /** Free-form named outputs written via setOutput (e.g. 'sources', 'links'). */
  readonly extra: Record<string, unknown> = {}

  constructor(init: { note: PipelineNote, workspaceId: string, db: PipelineDb }) {
    this.note = init.note
    this.workspaceId = init.workspaceId
    this.db = init.db
  }

  setOutput<T>(key: string, value: T): void {
    this.extra[key] = value
  }

  getOutput<T>(key: string): T | undefined {
    return this.extra[key] as T | undefined
  }
}
