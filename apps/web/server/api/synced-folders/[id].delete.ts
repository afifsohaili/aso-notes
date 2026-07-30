import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'
import { removeSyncedFolderAndCollectGarbage } from '../../lib/sync/gc'
import { emitSyncedFolderRemoved } from '../../lib/sync/synced-folders'

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
    throw createError({ statusCode: 404, statusMessage: 'Synced folder not found' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'No workspace found for user' })
  }

  const folder = await db
    .selectFrom('synced_folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst()

  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: 'Synced folder not found' })
  }

  const run = async (trx: any) => {
    const counts = await removeSyncedFolderAndCollectGarbage(trx, workspaceId, id)
    emitSyncedFolderRemoved({ workspaceId, syncedFolderId: id })
    return counts
  }

  if (db.isTransaction) {
    await sql`SAVEPOINT remove_synced_folder`.execute(db)
    try {
      const result = await run(db)
      return result
    }
    catch (error) {
      await sql`ROLLBACK TO SAVEPOINT remove_synced_folder`.execute(db)
      throw error
    }
  }

  const result = await db.transaction().execute(trx => run(trx))
  return result
})
