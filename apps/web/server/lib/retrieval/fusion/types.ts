/** A single ranked result: an id, in rank order. */
export interface RankedItem {
  id: string
}

/** A fused result: the id plus its fused relevance score. */
export interface FusedItem {
  id: string
  score: number
}

/** Fusion strategies. RRF is the only one implemented. */
export type FusionStrategy = 'rrf'
