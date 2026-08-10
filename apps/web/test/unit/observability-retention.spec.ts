import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import {
  DAILY_RETENTION_CRON,
  OBSERVABILITY_RETENTION_JOB_NAME,
  scheduleObservabilityRetentionRepeatableJobs,
} from '../../server/lib/observability/retention-worker-helpers'

function makeQueue(repeatableJobs: Array<{ name: string }> = []): Queue<unknown> {
  return {
    getRepeatableJobs: vi.fn().mockResolvedValue(repeatableJobs),
    add: vi.fn().mockResolvedValue(undefined),
  } as unknown as Queue<unknown>
}

describe('observability retention scheduler', () => {
  it('schedules a daily job when none exists', async () => {
    const queue = makeQueue([])
    await scheduleObservabilityRetentionRepeatableJobs(queue)

    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add).toHaveBeenCalledWith(
      OBSERVABILITY_RETENTION_JOB_NAME,
      {},
      { repeat: { cron: DAILY_RETENTION_CRON }, jobId: 'observability-retention:daily-retention' },
    )
  })

  it('does not duplicate an existing daily job', async () => {
    const queue = makeQueue([{ name: 'daily-retention' }])
    await scheduleObservabilityRetentionRepeatableJobs(queue)
    expect(queue.add).not.toHaveBeenCalled()
  })
})

describe('observability retention constants', () => {
  it('uses the daily cron at 04:30 and a stable queue job name', () => {
    expect(DAILY_RETENTION_CRON).toBe('30 4 * * *')
    expect(OBSERVABILITY_RETENTION_JOB_NAME).toBe('ObservabilityRetentionJob')
  })
})
