/**
 * Pure guard: did the user actually change the embedding model?
 * Embeddings from different models are never comparable — switching models
 * requires wiping and re-ingesting the workspace. Compare the previously
 * saved model against the value about to be saved, ignoring whitespace.
 */
export function didEmbeddingModelChange(previous: string | null | undefined, next: string | null | undefined): boolean {
  const normalizedPrevious = previous?.trim() ?? ''
  const normalizedNext = next?.trim() ?? ''
  return normalizedPrevious !== normalizedNext
}
