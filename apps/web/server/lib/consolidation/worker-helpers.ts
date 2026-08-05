import type { Queue } from 'bullmq'

export interface ConsolidationJobData {
  workspaceId?: string
  allWorkspaces?: boolean
  mode: 'full' | 'incremental' | 'manual'
}

export const CONSOLIDATION_JOB_NAME = 'ConsolidationJob'
export const NIGHTLY_INCREMENTAL_CRON = '0 3 * * *'
export const WEEKLY_FULL_CRON = '0 3 * * 0'

export async function isIngestionQueueIdle(queue: Queue<{ noteId: string }>): Promise<boolean> {
  const counts = await queue.getJobCounts('active', 'waiting')
  return (counts.active ?? 0) === 0 && (counts.waiting ?? 0) === 0
}

export async function scheduleConsolidationRepeatableJobs(queue: Queue<ConsolidationJobData>): Promise<void> {
  const existing = await queue.getRepeatableJobs()
  const existingNames = new Set(existing.map(j => j.name))

  if (!existingNames.has('nightly-incremental')) {
    await queue.add(CONSOLIDATION_JOB_NAME, { mode: 'incremental', allWorkspaces: true } as ConsolidationJobData, {
      repeat: { cron: NIGHTLY_INCREMENTAL_CRON },
      jobId: 'consolidation:nightly-incremental',
    })
  }

  if (!existingNames.has('weekly-full')) {
    await queue.add(CONSOLIDATION_JOB_NAME, { mode: 'full', allWorkspaces: true } as ConsolidationJobData, {
      repeat: { cron: WEEKLY_FULL_CRON },
      jobId: 'consolidation:weekly-full',
    })
  }
}
