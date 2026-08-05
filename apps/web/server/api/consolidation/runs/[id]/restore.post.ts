import { useDatabase } from '~~/utils/db'
import { restoreSnapshot } from '../../../../lib/consolidation/snapshot'

async function resolveWorkspaceId(db: any, userId: string): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}

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

  const result = await restoreSnapshot(db, snapshot.id, workspaceId)

  return { restored: true, ...result }
})
