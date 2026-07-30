import type { Job } from 'bullmq'
import type { IngestNoteJobData } from '../lib/sync/dispatcher'
import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { INGESTION_QUEUE_NAME } from '../lib/sync/dispatcher'
import { ingestNote } from '../lib/sync/ingest'
import { mapIngestionWorkerError } from '../lib/sync/ingestion-worker-error-policy'
import { handleFailedIngestionJob } from '../lib/sync/worker-failed'
import { useQueue } from '../utils/queue'
import { useWorker } from '../utils/worker'

/**
 * BullMQ consumer for the ingestion queue (plan-002-system §Sync service,
 * slow path). Only starts when Redis is configured — without it the sweeper
 * never enqueues, so there is nothing to consume.
 */
export default defineNitroPlugin(() => {
  // skip initialising worker on pre-render
  if (import.meta.prerender)
    return

  if (process.env.NUXT_DISABLE_NOTES_SYNC === '1')
    return

  if (!process.env.NUXT_REDIS_URL)
    return // logged once by the notes-sync plugin

  const config = useRuntimeConfig()
  const queue = useQueue<IngestNoteJobData>(INGESTION_QUEUE_NAME)

  const worker = useWorker(
    INGESTION_QUEUE_NAME,
    async (job: Job<IngestNoteJobData>) => {
      const db = useDatabase({ databaseUrl: config.databaseUrl })
      try {
        await ingestNote({
          db,
          noteId: job.data.noteId,
          worker: {
            attemptsMade: job.attemptsMade,
            jobId: job.id ?? null,
          },
        })
      }
      catch (error) {
        throw await mapIngestionWorkerError({ error, queue })
      }
    },
    {
      concurrency: 2,
      limiter: {
        max: 18,
        duration: 60_000,
      },
    },
  )

  worker.on('failed', async (job: Job | undefined, err: Error) => {
    console.error(`Ingestion job ${job?.id} failed after retries:`, err.message)

    // The catch block in ingestNote already records last_run and flips the
    // status to 'failed' for errors that happen inside the handler. This
    // handler covers crashes between BullMQ handing the job to the worker and
    // the handler completing, plus stalled jobs that exhaust retries.
    try {
      const db = useDatabase({ databaseUrl: config.databaseUrl })
      await handleFailedIngestionJob(db, job?.data?.noteId)
    }
    catch (dbError) {
      console.error(`Ingestion worker failed-handler: could not flip note ${job?.data?.noteId} to failed:`, dbError)
    }
  })

  console.warn('Ingestion worker initialized')
})
