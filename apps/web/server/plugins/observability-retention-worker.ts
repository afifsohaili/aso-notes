import type { Job } from 'bullmq'
import process from 'node:process'
import { ObservabilityRetentionJob } from '../lib/observability/retention-job'
import {
  OBSERVABILITY_RETENTION_QUEUE_NAME,
  scheduleObservabilityRetentionRepeatableJobs,
} from '../lib/observability/retention-worker-helpers'
import { registerBullMqJobAdapter } from '../utils/job-adapter'
import { useQueue } from '../utils/queue'
import { useWorker } from '../utils/worker'

export default defineNitroPlugin(() => {
  if (import.meta.prerender)
    return

  if (process.env.NUXT_DISABLE_OBSERVABILITY_RETENTION === '1')
    return

  if (!process.env.NUXT_REDIS_URL)
    return

  const queue = useQueue(OBSERVABILITY_RETENTION_QUEUE_NAME)

  registerBullMqJobAdapter()

  void scheduleObservabilityRetentionRepeatableJobs(queue)

  const worker = useWorker(
    OBSERVABILITY_RETENTION_QUEUE_NAME,
    async (job: Job) => {
      await new ObservabilityRetentionJob().perform(job.data as Parameters<ObservabilityRetentionJob['perform']>[0])
    },
    {
      concurrency: 1,
    },
  )

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`Observability retention job ${job?.id} failed after retries:`, err.message)
  })

  console.warn('Observability retention worker initialized')
})
