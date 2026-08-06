import type { ConsolidationDb, RunConsolidationOptions } from './types'
import type { ConsolidationJobData } from './worker-helpers'
import { ApplicationJob } from '@base/jobs'
import { useDatabase } from '~~/utils/db'
import { runConsolidation } from './engine'
import { ConsolidationLockConflictError } from './lock'

export const CONSOLIDATION_QUEUE_NAME = 'consolidation'

/**
 * Run one workspace sweep from the worker. A lock conflict means another
 * consolidation mutation (run or restore) is already in flight for the
 * workspace: skip quietly ('skipped') — scheduled cron jobs simply pick the
 * workspace up on the next tick, and a manual run can be re-triggered.
 */
export async function runConsolidationSweep(
  db: ConsolidationDb,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  options: RunConsolidationOptions = {},
): Promise<'completed' | 'skipped'> {
  try {
    await runConsolidation(db, workspaceId, mode, options)
    return 'completed'
  }
  catch (error) {
    if (error instanceof ConsolidationLockConflictError)
      return 'skipped'
    throw error
  }
}

export class ConsolidationJob extends ApplicationJob<ConsolidationJobData> {
  static queueName = CONSOLIDATION_QUEUE_NAME

  async perform(data: ConsolidationJobData): Promise<void> {
    const config = useRuntimeConfig()
    const db = useDatabase({ databaseUrl: config.databaseUrl })
    const consolidationDb = db as ConsolidationDb

    if (data.allWorkspaces) {
      const workspaces = await db.selectFrom('workspaces').select('id').execute()
      for (const workspace of workspaces) {
        await runConsolidationSweep(consolidationDb, workspace.id, data.mode)
      }
      return
    }

    if (data.workspaceId) {
      await runConsolidationSweep(consolidationDb, data.workspaceId, data.mode)
      return
    }

    throw new Error('Invalid consolidation job data: missing workspaceId or allWorkspaces')
  }
}
