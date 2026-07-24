import type { PipelineChunk } from './chunker'
import type { GraphExtraction, PipelineDb, PipelineNote } from './types'

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
  extraction?: GraphExtraction
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
