import { buildIngestionStatus } from '~~/server/lib/sync/ingestion-status'
import { getIngestionQueueSnapshot } from '~~/server/lib/sync/queue'
import { getSweeperState } from '~~/server/lib/sync/sweeper-state'
import { useDatabase } from '~~/utils/db'

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

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'No workspace found for user' })
  }

  const queue = getIngestionQueueSnapshot()
  const sweeper = getSweeperState()

  return buildIngestionStatus({
    db,
    workspaceId,
    queue,
    sweeperState: sweeper,
  })
})
