import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { getJobClass, type JobAdapter, type JobOpts } from '@base/jobs'
import type { EnqueuedJob } from './types'

function ensureEnvRedisUrl(): string {
  const url = process.env.NUXT_REDIS_URL || process.env.REDIS_URL
  if (!url) {
    throw new Error(
      'NUXT_REDIS_URL or REDIS_URL must be set to use queue mode "real".',
    )
  }
  return url
}

export interface JobRecorder {
  record: (job: EnqueuedJob) => void
}

export function createFakeAdapter(recorder: JobRecorder): JobAdapter {
  return {
    async enqueue(queue, name, data, opts) {
      recorder.record({ queue, name, data, opts })
    },
  }
}

export function createInlineAdapter(recorder: JobRecorder): JobAdapter {
  return {
    async enqueue(queue, name, data, opts) {
      recorder.record({ queue, name, data, opts })

      const jobClass = getJobClass(name)
      if (!jobClass) {
        throw new Error(
          `Inline queue mode cannot perform unknown job "${name}". ` +
          'Ensure the ApplicationJob subclass is imported before enqueueing.',
        )
      }

      const job = new jobClass()
      await job.perform(data)
    },
  }
}

export function createRealAdapter(): JobAdapter {
  const queues = new Map<string, Queue>()

  return {
    async enqueue(queueName, name, data, opts) {
      const url = ensureEnvRedisUrl()
      let queue = queues.get(queueName)
      if (!queue) {
        queue = new Queue(queueName, { connection: new Redis(url) })
        queues.set(queueName, queue)
      }
      await queue.add(name, data, opts)
    },
  }
}
