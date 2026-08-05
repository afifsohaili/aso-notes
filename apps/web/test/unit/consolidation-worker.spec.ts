import type { Job, Queue } from 'bullmq'
import type { ConsolidationJobData } from '../../server/lib/consolidation/worker-helpers'
import { describe, expect, it, vi } from 'vitest'
import { hasActiveOrWaitingConsolidationJob } from '../../server/lib/consolidation/queue-helpers'
import {
  CONSOLIDATION_JOB_NAME,

  isIngestionQueueIdle,
  scheduleConsolidationRepeatableJobs,
  WEEKLY_FULL_CRON,
} from '../../server/lib/consolidation/worker-helpers'

function makeQueue<T>(getJobs: (states: string[]) => Promise<Job<T>[]>): Queue<T> {
  return { getJobs } as unknown as Queue<T>
}

function makeJob<T>(data: T): Job<T> {
  return { data } as Job<T>
}

function makeIngestionQueue(counts: { active?: number, waiting?: number }): Queue<{ noteId: string }> {
  return {
    getJobCounts: vi.fn().mockResolvedValue(counts),
  } as unknown as Queue<{ noteId: string }>
}

function makeConsolidationQueue(jobs: Array<Partial<Job<ConsolidationJobData>>>, repeatableJobs: Array<{ name: string }> = []): Queue<ConsolidationJobData> {
  return {
    getJobs: vi.fn().mockResolvedValue(jobs.map(j => j as Job<ConsolidationJobData>)),
    getRepeatableJobs: vi.fn().mockResolvedValue(repeatableJobs),
    add: vi.fn().mockResolvedValue(undefined),
  } as unknown as Queue<ConsolidationJobData>
}

describe('consolidation run endpoint conflict check', () => {
  it('returns false when queue has no active or waiting jobs', async () => {
    const queue = makeQueue<ConsolidationJobData>(() => Promise.resolve([]))
    const result = await hasActiveOrWaitingConsolidationJob(queue, 'ws-1')
    expect(result).toBe(false)
  })

  it('returns true when a job matches the workspace', async () => {
    const queue = makeQueue<ConsolidationJobData>(() => Promise.resolve([makeJob({ workspaceId: 'ws-1', mode: 'manual' })]))
    const result = await hasActiveOrWaitingConsolidationJob(queue, 'ws-1')
    expect(result).toBe(true)
  })

  it('returns false when jobs are for other workspaces', async () => {
    const queue = makeQueue<ConsolidationJobData>(() => Promise.resolve([
      makeJob({ workspaceId: 'ws-2', mode: 'manual' }),
      makeJob({ workspaceId: 'ws-3', mode: 'incremental' }),
    ]))
    const result = await hasActiveOrWaitingConsolidationJob(queue, 'ws-1')
    expect(result).toBe(false)
  })

  it('returns false when a job has no workspaceId', async () => {
    const queue = makeQueue<ConsolidationJobData>(() => Promise.resolve([makeJob({ mode: 'full', allWorkspaces: true })]))
    const result = await hasActiveOrWaitingConsolidationJob(queue, 'ws-1')
    expect(result).toBe(false)
  })
})

describe('consolidation worker idle gate', () => {
  it('returns true when both active and waiting are zero', async () => {
    const queue = makeIngestionQueue({ active: 0, waiting: 0 })
    expect(await isIngestionQueueIdle(queue)).toBe(true)
  })

  it('returns false when active jobs exist', async () => {
    const queue = makeIngestionQueue({ active: 1, waiting: 0 })
    expect(await isIngestionQueueIdle(queue)).toBe(false)
  })

  it('returns false when waiting jobs exist', async () => {
    const queue = makeIngestionQueue({ active: 0, waiting: 3 })
    expect(await isIngestionQueueIdle(queue)).toBe(false)
  })
})

describe('consolidation worker scheduler', () => {
  it('schedules nightly incremental and weekly full jobs when none exist', async () => {
    const queue = makeConsolidationQueue([], [])
    await scheduleConsolidationRepeatableJobs(queue)

    expect(queue.add).toHaveBeenCalledTimes(2)
    expect(queue.add).toHaveBeenCalledWith(
      CONSOLIDATION_JOB_NAME,
      { mode: 'incremental', allWorkspaces: true },
      { repeat: { cron: '0 3 * * *' }, jobId: 'consolidation:nightly-incremental' },
    )
    expect(queue.add).toHaveBeenCalledWith(
      CONSOLIDATION_JOB_NAME,
      { mode: 'full', allWorkspaces: true },
      { repeat: { cron: WEEKLY_FULL_CRON }, jobId: 'consolidation:weekly-full' },
    )
  })

  it('does not duplicate existing repeatable jobs', async () => {
    const queue = makeConsolidationQueue([], [{ name: 'nightly-incremental' }, { name: 'weekly-full' }])
    await scheduleConsolidationRepeatableJobs(queue)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('only fills missing repeatable jobs', async () => {
    const queue = makeConsolidationQueue([], [{ name: 'weekly-full' }])
    await scheduleConsolidationRepeatableJobs(queue)

    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add).toHaveBeenCalledWith(
      CONSOLIDATION_JOB_NAME,
      { mode: 'incremental', allWorkspaces: true },
      { repeat: { cron: '0 3 * * *' }, jobId: 'consolidation:nightly-incremental' },
    )
  })
})
