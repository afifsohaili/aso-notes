/**
 * Pure upsert decision for a synced note file (plan-002-system §Sync service).
 * Kept side-effect free so the rename-guard semantics are table-testable.
 */

export interface ExistingNoteRow {
  id: string
  content_hash: string | null
  ingested_hash: string | null
}

export type UpsertDecision
  = | { kind: 'skip' }
    | { kind: 'insert' }
    | { kind: 'update', noteId: string }
    | { kind: 'rename', noteId: string }

/**
 * Decide what a file add/change means for the notes table:
 * - skip: content already synced (content_hash match) or already ingested
 *   (ingested_hash match) — a chokidar event for unchanged content is a no-op,
 *   and never resets the sweeper's settle clock.
 * - update: the row at this path has new content → re-sync, status='pending'.
 * - rename: the content hash lives on a row at a DIFFERENT path → move that
 *   row to this path, preserving id, links, status, and all derived data.
 * - insert: brand-new note.
 */
export function decideUpsert(args: {
  existingAtPath: ExistingNoteRow | null
  existingWithHash: { id: string } | null
  contentHash: string
}): UpsertDecision {
  const { existingAtPath, existingWithHash, contentHash } = args

  if (existingAtPath) {
    if (existingAtPath.content_hash === contentHash || existingAtPath.ingested_hash === contentHash)
      return { kind: 'skip' }
    return { kind: 'update', noteId: existingAtPath.id }
  }

  if (existingWithHash)
    return { kind: 'rename', noteId: existingWithHash.id }

  return { kind: 'insert' }
}
