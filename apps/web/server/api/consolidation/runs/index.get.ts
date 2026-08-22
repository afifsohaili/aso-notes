import { useDatabase } from '~~/utils/db'
import { computeConsolidationUsageForRuns } from '../../../lib/observability/usage'
import { resolveWorkspaceId } from '../../../utils/workspace'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    return { runs: [] }
  }

  const runs = await db
    .selectFrom('consolidation_runs')
    .select([
      'id',
      'workspace_id',
      'mode',
      'status',
      'started_at',
      'finished_at',
      'counts',
      'metrics_before',
      'metrics_after',
      'flags',
      'error',
      'created_at',
      'updated_at',
    ])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'desc')
    .execute()

  const runIds = runs.map(run => run.id)
  const usageByRun = await computeConsolidationUsageForRuns(db, runIds)

  const runsWithUsage = runs.map(run => ({
    ...run,
    usage: usageByRun.get(run.id) ?? null,
  }))

  return {
    runs: runsWithUsage.map(run => ({
      ...run,
      startedAt: run.started_at?.toISOString() ?? null,
      finishedAt: run.finished_at?.toISOString() ?? null,
      createdAt: run.created_at.toISOString(),
      updatedAt: run.updated_at.toISOString(),
    })),
  }
})
