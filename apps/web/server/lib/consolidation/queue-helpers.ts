import type { Job, Queue } from 'bullmq'
import type { ConsolidationJobData } from './job'

function isConsolidationJobForWorkspace(job: Job, workspaceId: string): job is Job<ConsolidationJobData> {
  const data = job.data as Partial<ConsolidationJobData> | undefined
  return !!data && typeof data.workspaceId === 'string' && data.workspaceId === workspaceId
}

export async function hasActiveOrWaitingConsolidationJob(
  queue: Queue<ConsolidationJobData>,
  workspaceId: string,
): Promise<boolean> {
  const jobs = await queue.getJobs(['active', 'waiting'])
  return jobs.some(job => isConsolidationJobForWorkspace(job, workspaceId))
}
