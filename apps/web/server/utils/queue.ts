import type { QueueOptions } from 'bullmq'
import process from 'node:process'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

// we use a map to store the queue instances, so that we can reuse them
const queueMap = new Map<string, Queue>()

export function useQueue<
  DataType = any,
  ResultType = any,
  NameType extends string = string,
>(name: string, opts?: Partial<Omit<QueueOptions, 'connection'>>) {
  if (queueMap.has(name)) {
    return queueMap.get(name)! as Queue<DataType, ResultType, NameType>
  }

  const { NUXT_REDIS_URL } = process.env
  if (!NUXT_REDIS_URL) {
    throw new Error('env NUXT_REDIS_URL is not defined')
  }

  const connection = new Redis(NUXT_REDIS_URL)
  queueMap.set(name, new Queue<DataType, ResultType, NameType>(name, {
    ...opts,
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30_000,
      },
      removeOnComplete: {
        age: 24 * 3600, // keep completed jobs for 24 hours
        count: 1000, // keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // keep failed jobs for 7 days
      },
      ...opts?.defaultJobOptions,
    },
  }))
  return queueMap.get(name) as Queue<DataType, ResultType, NameType>
}
