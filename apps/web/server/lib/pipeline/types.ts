import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { PipelineContext } from './context'

export type StageId = string
export type PipelineId = string

/** A notes-table row as loaded by the ingestion worker. */
export interface PipelineNote {
  id: string
  workspace_id: string
  folder_id: string | null
  path: string
  title: string
  content: string | null
  pipeline: string
}

/**
 * Structured graph extraction produced by the extract-graph stage (M4).
 * Shape locked in the plan: concepts, relations, chunk-level mentions.
 */
export interface GraphExtraction {
  concepts: { name: string, description: string }[]
  relations: { from: string, to: string, type: string }[]
  mentions: { concept: string, chunkRefs: number[] }[]
}

/** External source extracted from a note's raw markdown. */
export interface ExtractedSource {
  url: string
  urlNormalized: string
  type: 'youtube' | 'tiktok' | 'web'
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
