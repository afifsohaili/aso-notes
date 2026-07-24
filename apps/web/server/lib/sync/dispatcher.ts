/**
 * Ingestion dispatch seam (plan-002-system §Sync service, slow path).
 *
 * The sweeper never talks to BullMQ directly — it dispatches through this
 * small interface so tests can run ingestion inline (no Redis) while
 * production enqueues onto the BullMQ `ingestion` queue consumed by the
 * ingestion-worker Nitro plugin.
 */
import { useQueue } from '../../utils/queue'

export const INGESTION_QUEUE_NAME = 'ingestion'
export const INGEST_NOTE_JOB = 'ingest-note'

export interface IngestNoteJobData {
  noteId: string
}

export interface IngestionDispatcher {
  dispatch: (noteId: string) => Promise<void>
}

/** Structural subset of BullMQ's Queue — keeps the dispatcher testable without Redis. */
export interface IngestionQueueLike {
  add: (name: string, data: IngestNoteJobData) => Promise<unknown>
}

export function createBullMqDispatcher(queue: IngestionQueueLike): IngestionDispatcher {
  return {
    dispatch: noteId => queue.add(INGEST_NOTE_JOB, { noteId }).then(() => {}),
  }
}

export function createInlineDispatcher(run: (noteId: string) => Promise<void>): IngestionDispatcher {
  return { dispatch: run }
}

/**
 * Pick the dispatcher for this environment. Redis present → BullMQ producer
 * (queue created via the injectable factory; the default lazily uses
 * useQueue). No Redis → inline handler when provided (tests), else null and
 * the caller skips the sweep entirely.
 */
export function createSyncDispatcher(deps: {
  redisUrl: string | undefined
  createQueue?: () => IngestionQueueLike
  inlineRun?: (noteId: string) => Promise<void>
}): IngestionDispatcher | null {
  if (deps.redisUrl) {
    const createQueue = deps.createQueue ?? (() => useQueue<IngestNoteJobData>(INGESTION_QUEUE_NAME))
    return createBullMqDispatcher(createQueue())
  }
  if (deps.inlineRun)
    return createInlineDispatcher(deps.inlineRun)
  return null
}
