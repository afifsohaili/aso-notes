import { useDatabase } from '~~/utils/db'
import { ConsolidationLockConflictError } from '../../../../lib/consolidation/lock'
import { restoreSnapshot } from '../../../../lib/consolidation/snapshot'
import { resolveWorkspaceId } from '../../../../utils/workspace'

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
    .select('id')
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const snapshot = await db
    .selectFrom('consolidation_snapshots')
    .select('id')
    .where('run_id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()

  if (!snapshot) {
    throw createError({ statusCode: 404, statusMessage: 'Snapshot not found for this run' })
  }

  try {
    const result = await restoreSnapshot(db, snapshot.id, workspaceId)
    return { restored: true, ...result }
  }
  catch (error) {
    if (error instanceof ConsolidationLockConflictError) {
      throw createError({ statusCode: 409, statusMessage: 'A consolidation run is in progress for this workspace' })
    }
    throw error
  }
})
