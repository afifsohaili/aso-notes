import type { ObservabilityRetentionJobData } from './retention-worker-helpers'
import { ApplicationJob } from '@base/jobs'
import { useDatabase } from '~~/utils/db'
import { runObservabilityRetentionSweep } from './retention'
import { OBSERVABILITY_RETENTION_QUEUE_NAME } from './retention-worker-helpers'

export class ObservabilityRetentionJob extends ApplicationJob<ObservabilityRetentionJobData> {
  static queueName = OBSERVABILITY_RETENTION_QUEUE_NAME

  async perform(_data: ObservabilityRetentionJobData): Promise<void> {
    const config = useRuntimeConfig()
    const db = useDatabase({ databaseUrl: config.databaseUrl })
    await runObservabilityRetentionSweep(db)
  }
}
