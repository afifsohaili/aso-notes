import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { ConsolidationJobData } from './worker-helpers'
import { ApplicationJob } from '@base/jobs'
import { useDatabase } from '~~/utils/db'
import { runConsolidation } from './engine'

export const CONSOLIDATION_QUEUE_NAME = 'consolidation'

export class ConsolidationJob extends ApplicationJob<ConsolidationJobData> {
  static queueName = CONSOLIDATION_QUEUE_NAME

  async perform(data: ConsolidationJobData): Promise<void> {
    const config = useRuntimeConfig()
    const db = useDatabase({ databaseUrl: config.databaseUrl })
    const consolidationDb = db as Kysely<DB> | Transaction<DB>

    if (data.allWorkspaces) {
      const workspaces = await db.selectFrom('workspaces').select('id').execute()
      for (const workspace of workspaces) {
        await runConsolidation(consolidationDb, workspace.id, data.mode)
      }
      return
    }

    if (data.workspaceId) {
      await runConsolidation(consolidationDb, data.workspaceId, data.mode)
      return
    }

    throw new Error('Invalid consolidation job data: missing workspaceId or allWorkspaces')
  }
}
