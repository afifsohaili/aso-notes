import type { Job } from 'bullmq'
import process from 'node:process'
import { CONSOLIDATION_QUEUE_NAME, ConsolidationJob } from '../lib/consolidation/job'
import { isIngestionQueueIdle, scheduleConsolidationRepeatableJobs } from '../lib/consolidation/worker-helpers'
import { INGESTION_QUEUE_NAME } from '../lib/sync/dispatcher'
import { registerBullMqJobAdapter } from '../utils/job-adapter'
import { useQueue } from '../utils/queue'
import { useWorker } from '../utils/worker'

export default defineNitroPlugin(() => {
  if (import.meta.prerender)
    return

  if (process.env.NUXT_DISABLE_CONSOLIDATION === '1')
    return

  if (!process.env.NUXT_REDIS_URL)
    return

  const queue = useQueue(CONSOLIDATION_QUEUE_NAME)
  const ingestionQueue = useQueue<{ noteId: string }>(INGESTION_QUEUE_NAME)

  registerBullMqJobAdapter()

  void scheduleConsolidationRepeatableJobs(queue)

  const worker = useWorker(
    CONSOLIDATION_QUEUE_NAME,
    async (job: Job) => {
      const idle = await isIngestionQueueIdle(ingestionQueue)
      if (!idle) {
        throw new Error('Ingestion queue is busy; rescheduling consolidation job')
      }

      await new ConsolidationJob().perform(job.data as Parameters<ConsolidationJob['perform']>[0])
    },
    {
      concurrency: 1,
    },
  )

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`Consolidation job ${job?.id} failed after retries:`, err.message)
  })

  console.warn('Consolidation worker initialized')
})
