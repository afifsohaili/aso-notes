import type { JobAdapter } from '@base/jobs'
import { registerJobAdapter } from '@base/jobs'
import { useQueue } from './queue'

/**
 * Production JobAdapter backed by BullMQ. Registered by the consolidation worker
 * plugin so that ApplicationJob.performLater reaches a real queue.
 */
export function createBullMqJobAdapter(): JobAdapter {
  return {
    async enqueue(queueName, name, data, opts) {
      const queue = useQueue(queueName)
      await queue.add(name, data, opts)
    },
  }
}

export function registerBullMqJobAdapter(): void {
  registerJobAdapter(createBullMqJobAdapter())
}
