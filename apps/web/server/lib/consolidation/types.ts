import type { EmbeddingProvider } from '../ai/types'

export interface RunConsolidationOptions {
  judge?: ConsolidationJudge
  embeddingProvider?: EmbeddingProvider
  now?: Date
}

export interface MergeCandidate {
  kind: 'concept' | 'topic'
  pairId: string
  id: string
  name: string
  description: string | null
  otherId: string
  otherName: string
  otherDescription: string | null
  similarity: number
}

export interface PruneCandidate {
  kind: 'concept' | 'topic'
  id: string
  name: string
  description: string | null
  mentionCount: number
  relationCount: number
  sampleChunkText: string | null
}

export interface MergeVerdict {
  kind: 'concept' | 'topic'
  pairId: string
  merge: boolean
  survivorId: string
  mergedDescription: string | null
  reason: string
}

export interface PruneVerdict {
  kind: 'concept' | 'topic'
  id: string
  prune: boolean
  reason: string
}

export interface ConsolidationJudgeRequest {
  mergePairs: MergeCandidate[]
  pruneCandidates: PruneCandidate[]
}

export interface ConsolidationJudgeResponse {
  merges: MergeVerdict[]
  prunes: PruneVerdict[]
}

export type ConsolidationJudge = (request: ConsolidationJudgeRequest) => Promise<ConsolidationJudgeResponse>

export interface ConsolidationRunResult {
  runId: string
  status: 'completed' | 'failed'
  metricsBefore: ConsolidationMetrics
  metricsAfter: ConsolidationMetrics
  flags: ConsolidationFlags
  counts: ConsolidationCounts
}

export interface ConsolidationMetrics {
  concepts: number
  topics: number
  nearDupeRate: number
  orphanRate: number
  conceptsPerNote: number
  topicSpread: number
}

export interface ConsolidationFlags {
  overPruning: boolean
  ineffectiveness: boolean
}

export interface ConsolidationCounts {
  merges: number
  prunes: number
  rewrites: number
  dissolves: number
  refiles: number
  judgeCalls: number
}

export const COSINE_THRESHOLD = 0.75
export const NEIGHBOR_TOP_K = 10
export const JUDGE_BATCH_SIZE = 20
export const PRUNE_GRACE_DAYS = 7
export const NEAR_DUPE_THRESHOLD = 0.9
