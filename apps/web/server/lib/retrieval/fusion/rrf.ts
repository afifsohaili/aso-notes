import type { FusedItem, FusionStrategy, RankedItem } from './types'

/** RRF constant: the fixed `k` used in the `k + rank` denominator. */
const RRF_K = 60

/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Each ranked list contributes `1 / (k + rank)` per item, where `rank` is
 * 1-based position in that list and `k` is the fixed RRF constant (60).
 * Contributions are summed per item and the fused list is ordered by
 * descending score, ties broken by ascending id.
 */
export function rrfFuse(lists: RankedItem[][]): FusedItem[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!
      const contribution = 1 / (RRF_K + rank + 1)
      scores.set(item.id, (scores.get(item.id) ?? 0) + contribution)
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

/**
 * Dispatch to the configured fusion strategy. RRF is the only strategy
 * implemented; a weighted-score fusion can be added here later without
 * changing callers.
 */
export function fuseRankedLists(
  lists: RankedItem[][],
  options: { strategy?: FusionStrategy } = {},
): FusedItem[] {
  const strategy = options.strategy ?? 'rrf'
  if (strategy !== 'rrf')
    throw new Error(`unsupported fusion strategy: ${strategy}`)
  return rrfFuse(lists)
}
