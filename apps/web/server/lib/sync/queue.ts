/**
 * Ingestion queue accessor for observability endpoints (plan-004 Phase 2 O6).
 *
 * Exposes a tiny, testable subset of BullMQ's Queue surface so the status
 * endpoint can read counts and active jobs without reaching into Redis
 * internals. Production uses the BullMQ queue via `useQueue`; tests can
 * inject a fake snapshot with `setIngestionQueueOverride`.
 */
import type { Queue } from 'bullmq'
import type { IngestNoteJobData } from './dispatcher'
import process from 'node:process'
import { useQueue } from '../../utils/queue'
import { INGESTION_QUEUE_NAME } from './dispatcher'

export interface IngestionQueueCounts {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface IngestionQueueActiveJob {
  id: string
  noteId: string
}

export interface IngestionQueueSnapshot {
  getJobCounts: () => Promise<IngestionQueueCounts>
  getActiveJobs: () => Promise<IngestionQueueActiveJob[]>
}

let override: IngestionQueueSnapshot | null | undefined

/** Replace the production queue snapshot for the current process (tests). */
export function setIngestionQueueOverride(queue: IngestionQueueSnapshot | null): void {
  override = queue
}

/** Clear the override and revert to the production accessor. */
export function clearIngestionQueueOverride(): void {
  override = undefined
}

/** Return the live ingestion queue snapshot, or `null` when Redis is not configured. */
export function getIngestionQueueSnapshot(): IngestionQueueSnapshot | null {
  if (override !== undefined)
    return override

  if (!process.env.NUXT_REDIS_URL)
    return null

  const queue = useQueue<IngestNoteJobData>(INGESTION_QUEUE_NAME)
  return wrapQueue(queue)
}

function wrapQueue(queue: Queue<IngestNoteJobData>): IngestionQueueSnapshot {
  return {
    getJobCounts: async () => {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      }
    },
    getActiveJobs: async () => {
      const jobs = await queue.getJobs(['active'])
      return jobs.map(job => ({
        id: job.id ?? '',
        noteId: job.data?.noteId ?? job.id ?? '',
      }))
    },
  }
}
