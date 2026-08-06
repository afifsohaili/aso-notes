import { useDatabase } from '~~/utils/db'
import { resolveWorkspaceId } from '../../../utils/workspace'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 403, statusMessage: 'No workspace membership' })
  }

  const run = await db
    .selectFrom('consolidation_runs')
    .select([
      'id',
      'workspace_id',
      'mode',
      'status',
      'started_at',
      'finished_at',
      'counts',
      'usage',
      'metrics_before',
      'metrics_after',
      'flags',
      'error',
      'created_at',
      'updated_at',
    ])
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const changes = await db
    .selectFrom('consolidation_run_changes')
    .select(['id', 'action', 'text', 'reason', 'created_at'])
    .where('run_id', '=', id)
    .orderBy('created_at', 'desc')
    .execute()

  const snapshot = await db
    .selectFrom('consolidation_snapshots')
    .select('id')
    .where('run_id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()

  return {
    run: {
      ...run,
      startedAt: run.started_at?.toISOString() ?? null,
      finishedAt: run.finished_at?.toISOString() ?? null,
      createdAt: run.created_at.toISOString(),
      updatedAt: run.updated_at.toISOString(),
    },
    changes: changes.map(change => ({
      ...change,
      createdAt: change.created_at.toISOString(),
    })),
    hasSnapshot: !!snapshot,
  }
})
