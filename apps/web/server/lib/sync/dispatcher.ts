/**
 * Ingestion dispatch seam (plan-002-system §Sync service, slow path).
 *
 * The sweeper never talks to BullMQ directly — it dispatches through this
 * small interface so tests can run ingestion inline (no Redis) while
 * production enqueues onto the BullMQ `ingestion` queue consumed by the
 * ingestion-worker Nitro plugin.
 */
import type { SyncDb } from './sweeper'
import { sql } from 'kysely'
import { useQueue } from '../../utils/queue'

export const INGESTION_QUEUE_NAME = 'ingestion'
export const INGEST_NOTE_JOB = 'ingest-note'

export interface IngestNoteJobData {
  noteId: string
}

export interface IngestionDispatcher {
  dispatch: (noteId: string) => Promise<void>
}

/** Minimal BullMQ Job surface the dispatcher needs. */
export interface IngestionJobLike {
  getState: () => Promise<string>
  remove?: () => Promise<unknown>
}

/** Structural subset of BullMQ's Queue — keeps the dispatcher testable without Redis. */
export interface IngestionQueueLike {
  add: (name: string, data: IngestNoteJobData, opts?: { jobId: string }) => Promise<unknown>
  getJob?: (jobId: string) => Promise<IngestionJobLike | undefined>
  remove?: (jobId: string) => Promise<unknown>
}

/**
 * Flip a note into the 'queued' state. Guarded to only move from pending/queued
 * so ingested/failed/processing rows are never rolled backwards.
 */
async function markNoteQueued(db: SyncDb, noteId: string): Promise<void> {
  await db
    .updateTable('notes')
    .set({ status: 'queued', updated_at: sql`now()` })
    .where('id', '=', noteId)
    .where('status', 'in', ['pending', 'queued'])
    .execute()
}

export function createBullMqDispatcher(args: {
  db: SyncDb
  queue: IngestionQueueLike
}): IngestionDispatcher {
  const { db, queue } = args
  return {
    dispatch: async (noteId) => {
      // jobId = noteId dedupes re-dispatch of the same note (stale queued
      // re-sweep, manual re-process). BullMQ's dedupe also makes add() a
      // silent no-op when a FAILED/COMPLETED job with the same id lingers
      // (removeOnFail keeps them for 7 days) — remove terminal-state jobs
      // first so a retry actually re-enqueues. Active/waiting jobs are left
      // alone.
      const existing = queue.getJob ? await queue.getJob(noteId) : undefined
      if (existing) {
        const state = await existing.getState()
        if (state === 'failed' || state === 'completed')
          await queue.remove?.(noteId)
      }
      await queue.add(INGEST_NOTE_JOB, { noteId }, { jobId: noteId })
      // Only flip status after a successful enqueue. If the queue throws, the
      // note stays pending and the sweeper will retry on the next pass.
      await markNoteQueued(db, noteId)
    },
  }
}

export function createInlineDispatcher(args: {
  db: SyncDb
  run: (noteId: string) => Promise<void>
}): IngestionDispatcher {
  const { db, run } = args
  return {
    dispatch: async (noteId) => {
      // Same state transition as BullMQ so tests and the no-Redis path see a
      // consistent queue-shaped status.
      await markNoteQueued(db, noteId)
      await run(noteId)
    },
  }
}

/**
 * Remove ingestion jobs for the given note ids regardless of state (used by
 * graph rebuild). BullMQ's jobId=noteId dedupe makes add() a silent no-op
 * while ANY job with the same id lingers — failed, completed, delayed retry,
 * or stuck active — so a rebuild must clear them or the re-dispatched notes
 * never reach a worker. Jobs that refuse removal (locked by a worker) are
 * skipped and not counted; the sweeper's terminal-state removal covers them
 * on the next dispatch.
 */
export async function purgeIngestionJobs(
  queue: IngestionQueueLike,
  noteIds: string[],
): Promise<number> {
  let purged = 0
  for (const noteId of noteIds) {
    try {
      const existing = queue.getJob ? await queue.getJob(noteId) : undefined
      if (!existing)
        continue
      // Job#remove (not Queue#remove): Queue#remove silently no-ops on
      // locked jobs while still resolving, so it can't be counted. Job#remove
      // throws when locked — caught below and skipped.
      await (existing.remove ? existing.remove() : queue.remove?.(noteId))
      purged++
    }
    catch {
      // Locked/active jobs refuse removal; skip without failing the rebuild.
    }
  }
  return purged
}

/**
 * Pick the dispatcher for this environment. Redis present → BullMQ producer
 * (queue created via the injectable factory; the default lazily uses
 * useQueue). No Redis → inline handler when provided (tests), else null and
 * the caller skips the sweep entirely.
 */
export function createSyncDispatcher(deps: {
  db: SyncDb
  redisUrl: string | undefined
  createQueue?: () => IngestionQueueLike
  inlineRun?: (noteId: string) => Promise<void>
}): IngestionDispatcher | null {
  if (deps.redisUrl) {
    const createQueue = deps.createQueue ?? (() => useQueue<IngestNoteJobData>(INGESTION_QUEUE_NAME))
    return createBullMqDispatcher({ db: deps.db, queue: createQueue() })
  }
  if (deps.inlineRun)
    return createInlineDispatcher({ db: deps.db, run: deps.inlineRun })
  return null
}
