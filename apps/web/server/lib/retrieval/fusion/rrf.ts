import type { FusedItem, FusionStrategy, RankedItem } from './types'

const DEFAULT_K = 60

/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Each ranked list contributes `weight / (k + rank)` per item, where `rank`
 * is 1-based position in that list. Contributions are summed per item and the
 * fused list is ordered by descending score, ties broken by ascending id.
 */
export function rrfFuse(
  lists: RankedItem[][],
  options: { k?: number, weights?: number[] } = {},
): FusedItem[] {
  const k = options.k ?? DEFAULT_K
  const weights = options.weights ?? lists.map(() => 1)

  const scores = new Map<string, number>()
  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const list = lists[listIndex]!
    const weight = weights[listIndex] ?? 1
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!
      const contribution = weight / (k + rank + 1)
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
  options: { strategy?: FusionStrategy, k?: number, weights?: number[] } = {},
): FusedItem[] {
  const strategy = options.strategy ?? 'rrf'
  if (strategy !== 'rrf')
    throw new Error(`unsupported fusion strategy: ${strategy}`)
  return rrfFuse(lists, { k: options.k, weights: options.weights })
}
