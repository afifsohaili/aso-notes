import { EMBEDDING_DIMENSIONS } from './types'

/**
 * Guarantee a vector is exactly `target` dimensions (default the graph-store
 * width, 2048). Shorter vectors are zero-padded with trailing zeros; longer
 * vectors are unsupported and throw. Zero-padding is retrieval-safe: cosine
 * distance is unchanged when stored and query vectors are padded consistently.
 */
export function normalizeEmbeddingDimensions(vector: number[], target: number = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length === target)
    return vector
  if (vector.length > target) {
    throw new Error(
      `Embedding returned ${vector.length} dimensions, above the ${target} target — pick a smaller model or widen the graph store`,
    )
  }
  const result = [...vector]
  while (result.length < target)
    result.push(0)
  return result
}
