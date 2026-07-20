import {
  ApplicationJob,
  getActiveJobAdapter,
  getJobClass,
  listRegisteredJobs,
  registerJob,
  registerJobAdapter,
} from './application-job'
import type { ApplicationJobClass, JobAdapter, JobOpts } from './application-job'

export interface CronJobDef {
  name: string
  schedule: string
  jobClass: ApplicationJobClass
}

const cronJobs = new Map<string, CronJobDef>()

export function defineCronJob(
  name: string,
  schedule: string,
  jobClass: ApplicationJobClass,
): CronJobDef {
  const def = { name, schedule, jobClass }
  cronJobs.set(name, def)
  return def
}

export function listCronJobs(): CronJobDef[] {
  return Array.from(cronJobs.values())
}

export async function startAllWorkers(_opts?: { concurrency?: number }): Promise<void> {
  // Phase 1 skeleton: production worker bootstrap is implemented in WS7.
  // This stub keeps the API contract intact for the test harness.
  const adapter = getActiveJobAdapter()
  if (!adapter) {
    throw new Error(
      'No job adapter registered. Configure a BullMQ adapter before calling startAllWorkers().',
    )
  }
}

export {
  ApplicationJob,
  getActiveJobAdapter,
  getJobClass,
  listRegisteredJobs,
  registerJob,
  registerJobAdapter,
}

export type { ApplicationJobClass, JobAdapter, JobOpts }
