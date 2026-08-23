import { EMBEDDING_DIMENSIONS } from './types'

/**
 * Thrown by `normalizeEmbeddingDimensions` when a provider returns a vector
 * longer than the target (graph-store) width. That model cannot reach the
 * target and is unsupported. Consumers (e.g. the settings test-connection
 * probe) catch this with `instanceof` to surface a clear, user-facing error —
 * so the message must never be string-matched.
 */
export class OverDimensionsError extends Error {
  constructor(actual: number, target: number) {
    super(
      `Embedding returned ${actual} dimensions, above the ${target} target — pick a smaller model or widen the graph store`,
    )
    this.name = 'OverDimensionsError'
  }
}

/**
 * Guarantee a vector is exactly `target` dimensions (default the graph-store
 * width, 2048). Shorter vectors are zero-padded with trailing zeros; longer
 * vectors are unsupported and throw. Zero-padding is retrieval-safe: cosine
 * distance is unchanged when stored and query vectors are padded consistently.
 */
export function normalizeEmbeddingDimensions(vector: number[], target: number = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length === target)
    return vector
  if (vector.length > target)
    throw new OverDimensionsError(vector.length, target)
  const result = [...vector]
  while (result.length < target)
    result.push(0)
  return result
}
