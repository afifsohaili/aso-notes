/** A single ranked result: an id plus any caller payload, in rank order. */
export interface RankedItem {
  id: string
  [key: string]: unknown
}

/** A fused result: the id plus its fused relevance score. */
export interface FusedItem {
  id: string
  score: number
}

/** Fusion strategies. RRF is the only one implemented. */
export type FusionStrategy = 'rrf'
