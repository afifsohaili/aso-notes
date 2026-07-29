import type { PipelineChunk } from '../chunker'
import type { PipelineDb } from '../types'

/** A concept already present in the workspace, returned by a vocabulary strategy. */
export interface ExistingConcept {
  id: string
  name: string
  description: string | null
}

/** A topic already present in the workspace, returned by a vocabulary strategy. */
export interface ExistingTopic {
  id: string
  name: string
  description: string | null
}

/** Chunks that have already been embedded by the embed-chunks stage. */
export interface EmbeddedChunk extends PipelineChunk {
  embedding: number[]
}

/** The vocabulary injected into an extraction prompt. */
export interface Vocabulary {
  concepts: ExistingConcept[]
  tags: string[]
  topics: ExistingTopic[]
}

/** Strategy for choosing which existing vocabulary to inject into extraction. */
export interface VocabularyStrategy {
  id: string
  /**
   * Load the vocabulary to inject into the extraction prompt.
   * `embeddedChunks` are the note's chunks after embedding; strategies may use
   * them for similarity ranking (top-k) or ignore them (full, blind-merge).
   */
  loadVocabulary: (db: PipelineDb, workspaceId: string, embeddedChunks: EmbeddedChunk[]) => Promise<Vocabulary>
  /**
   * Whether store-graph should run an embedding-similarity merge pass for
   * concepts and topics that missed exact normalized-name resolution.
   */
  mergeOnStore: boolean
}
