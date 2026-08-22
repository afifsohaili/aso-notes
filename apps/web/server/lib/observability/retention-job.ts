import type { Queue } from 'bullmq'
import { ApplicationJob } from '@base/jobs'
import { useDatabase } from '~~/utils/db'
import { runObservabilityRetentionSweep } from './retention'

export const OBSERVABILITY_RETENTION_QUEUE_NAME = 'observability-retention'
export const OBSERVABILITY_RETENTION_JOB_NAME = 'ObservabilityRetentionJob'
export const DAILY_RETENTION_CRON = '30 4 * * *'

export interface ObservabilityRetentionJobData {
  /** No per-job payload; the sweep operates across all workspaces. */
}

export async function scheduleObservabilityRetentionRepeatableJobs(
  queue: Queue<ObservabilityRetentionJobData>,
): Promise<void> {
  const existing = await queue.getRepeatableJobs()
  const existingNames = new Set(existing.map(j => j.name))

  if (!existingNames.has('daily-retention')) {
    await queue.add(OBSERVABILITY_RETENTION_JOB_NAME, {}, {
      repeat: { cron: DAILY_RETENTION_CRON },
      jobId: 'observability-retention:daily-retention',
    })
  }
}

export class ObservabilityRetentionJob extends ApplicationJob<ObservabilityRetentionJobData> {
  static queueName = OBSERVABILITY_RETENTION_QUEUE_NAME

  async perform(_data: ObservabilityRetentionJobData): Promise<void> {
    const config = useRuntimeConfig()
    const db = useDatabase({ databaseUrl: config.databaseUrl })
    await runObservabilityRetentionSweep(db)
  }
}
