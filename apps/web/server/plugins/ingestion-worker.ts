import type { Job } from 'bullmq'
import type { IngestNoteJobData } from '../lib/sync/dispatcher'
import process from 'node:process'
import { INGESTION_QUEUE_NAME } from '../lib/sync/dispatcher'
import { ingestNote } from '../lib/sync/ingest'

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

  const worker = useWorker(
    INGESTION_QUEUE_NAME,
    async (job: Job<IngestNoteJobData>) => {
      const db = useDatabase({ databaseUrl: config.databaseUrl })
      await ingestNote({ db, noteId: job.data.noteId })
    },
    {
      concurrency: 2,
    },
  )

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`Ingestion job ${job?.id} failed after retries:`, err.message)
  })

  console.warn('Ingestion worker initialized')
})
