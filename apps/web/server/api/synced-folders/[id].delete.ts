import { useDatabase } from '~~/utils/db'
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

  const countRow = await db
    .selectFrom('notes')
    .select(eb => eb.fn.count('id').as('c'))
    .where('synced_folder_id', '=', id)
    .executeTakeFirstOrThrow()

  if (Number(countRow.c) > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Cannot remove synced folder with existing notes' })
  }

  await db
    .deleteFrom('synced_folders')
    .where('id', '=', id)
    .execute()

  emitSyncedFolderRemoved({ workspaceId, syncedFolderId: id })

  return { ok: true }
})
