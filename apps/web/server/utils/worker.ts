import type { Processor, WorkerOptions } from 'bullmq'
import process from 'node:process'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'

// we use a map to store the worker instances, so that we can reuse them
const workerMap = new Map<string, Worker>()

export function useWorker(name: string, fn: string | URL | Processor, opts?: Partial<Omit<WorkerOptions, 'connection'>>) {
  if (workerMap.has(name)) {
    return workerMap.get(name)!
  }

  const { NUXT_REDIS_URL } = process.env
  if (!NUXT_REDIS_URL) {
    throw new Error('env NUXT_REDIS_URL is not defined')
  }

  const connection = new Redis(NUXT_REDIS_URL, {
    /**
     * Is better to set this as `null`
     * @see https://docs.bullmq.io/guide/connections#maxretriesperrequest
     */
    maxRetriesPerRequest: null,
  })

  const worker = new Worker(name, fn, { ...opts, connection })

  // Add default error handling
  worker.on('error', (err) => {
    console.error(`Worker ${name} error:`, err)
  })

  workerMap.set(name, worker)
  return worker
}
