import { getJobClass, registerJobAdapter } from '@base/jobs'
import { createFakeAdapter, createInlineAdapter, createRealAdapter } from './adapter'
import type { EnqueuedJob, QueueMode, QueueTestingFacade } from './types'

class FakeRecorder {
  private jobs: EnqueuedJob[] = []

  record(job: EnqueuedJob): void {
    this.jobs.push(job)
  }

  jobsFor(queue?: string): EnqueuedJob[] {
    return queue ? this.jobs.filter(j => j.queue === queue) : [...this.jobs]
  }

  clear(queue?: string): void {
    if (queue) {
      this.jobs = this.jobs.filter(j => j.queue !== queue)
    }
    else {
      this.jobs = []
    }
  }

  reset(): void {
    this.jobs = []
  }
}

class QueueTestingImpl implements QueueTestingFacade {
  private mode: QueueMode = 'fake'
  private recorder = new FakeRecorder()
  private fakeAdapter = createFakeAdapter(this.recorder)
  private inlineAdapter = createInlineAdapter(this.recorder)
  private realAdapter = createRealAdapter()

  constructor() {
    this.installAdapter()
  }

  setMode(mode: QueueMode): void {
    this.mode = mode
    this.installAdapter()
  }

  private installAdapter(): void {
    const adapter = this.mode === 'fake'
      ? this.fakeAdapter
      : this.mode === 'inline'
        ? this.inlineAdapter
        : this.realAdapter
    registerJobAdapter(adapter)
  }

  enqueuedJobs(queue?: string): EnqueuedJob[] {
    return this.recorder.jobsFor(queue)
  }

  async performEnqueuedJobs(queue?: string, opts?: { includeDelayed?: boolean }): Promise<void> {
    const includeDelayed = opts?.includeDelayed ?? false
    const jobs = this.recorder.jobsFor(queue)

    for (const job of jobs) {
      if (!includeDelayed && job.opts?.delay) {
        continue
      }

      const jobClass = getJobClass(job.name)
      if (!jobClass) {
        throw new Error(
          `Cannot perform unknown job "${job.name}". ` +
          'Ensure the ApplicationJob subclass is imported before draining the queue.',
        )
      }

      const instance = new jobClass()
      await instance.perform(job.data)
    }

    this.recorder.clear(queue)
  }

  reset(): void {
    this.mode = 'fake'
    this.recorder.reset()
    this.installAdapter()
  }
}

export const queueTesting: QueueTestingFacade = new QueueTestingImpl()

/**
 * Install the test queue adapter in the given mode.
 * This is called automatically by the @base/testing setup; specs normally
 * switch modes via the `queue` fixture (`queue.setMode('inline')`).
 */
export function installQueueTestAdapter(mode: QueueMode): void {
  queueTesting.setMode(mode)
}

export type { EnqueuedJob, QueueMode, QueueTestingFacade }
