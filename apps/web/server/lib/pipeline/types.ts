import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { PipelineContext } from './context'

export type StageId = string
export type PipelineId = string

/** A notes-table row as loaded by the ingestion worker. */
export interface PipelineNote {
  id: string
  workspace_id: string
  synced_folder_id: string
  folder_id: string | null
  path: string
  title: string
  content: string | null
  content_hash: string | null
  pipeline: string
}

/**
 * Structured graph extraction produced by the extract-graph stage (M4).
 * Shape locked in the plan: topics, concepts (each assigned to 1–3 topics),
 * relations, chunk-level mentions, plus suggested tag names.
 */
export interface GraphExtraction {
  topics: { name: string, description: string }[]
  concepts: { name: string, description: string, topics: string[] }[]
  relations: { from: string, to: string, type: string, description?: string }[]
  mentions: { concept: string, chunkRefs: number[] }[]
  tags: string[]
}

/** External source extracted from a note's raw markdown. */
export interface ExtractedSource {
  url: string
  urlNormalized: string
  type: 'youtube' | 'tiktok' | 'web'
}

/** Internal note-to-note link extracted from a note's raw markdown. */
export interface ExtractedLink {
  /** The target as written; retained when the link dangles. */
  rawTarget: string
  /** Resolved notes.id, or null while the target note doesn't exist. */
  toNoteId: string | null
}

export type PipelineDb = Kysely<DB> | Transaction<DB>

/**
 * A pipeline stage. Stages are stateless — all mutable state lives on the
 * PipelineContext — so a single instance can be shared across runs.
 */
export interface Stage {
  readonly id: StageId
  invoke: (ctx: PipelineContext) => Promise<void>
}
