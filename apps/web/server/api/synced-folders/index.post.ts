import { useDatabase } from '~~/utils/db'
import { emitSyncedFolderAdded, SyncedFolderValidationError, validateSyncedFolderPath } from '../../lib/sync/synced-folders'

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

  const body = await readBody(event)
  const existing = await db
    .selectFrom('synced_folders')
    .select('path')
    .where('workspace_id', '=', workspaceId)
    .execute()

  let normalized: string
  try {
    normalized = validateSyncedFolderPath(body?.path, existing.map(r => r.path)).normalized
  }
  catch (err) {
    if (err instanceof SyncedFolderValidationError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }

  const inserted = await db
    .insertInto('synced_folders')
    .values({
      workspace_id: workspaceId,
      path: normalized,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  emitSyncedFolderAdded({ workspaceId, syncedFolderId: inserted.id, path: normalized })

  return {
    id: inserted.id,
    path: inserted.path,
    createdAt: inserted.created_at.toISOString(),
    updatedAt: inserted.updated_at.toISOString(),
  }
})
