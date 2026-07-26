import { processPendingNotes, resolveProcessDispatcher } from '~~/server/lib/sync/process'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const body = await readBody(event)
  const folder = typeof body?.folder === 'string' ? body.folder : null

  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', event.context.user.id)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'No workspace membership' })
  }

  let folderId: string | null = null
  if (folder && folder !== '/') {
    const folderRow = await db
      .selectFrom('folders')
      .select('id')
      .where('workspace_id', '=', membership.workspace_id)
      .where('path', '=', folder)
      .executeTakeFirst()

    if (!folderRow) {
      throw createError({ statusCode: 404, statusMessage: 'Folder not found' })
    }
    folderId = folderRow.id
  }

  const dispatcher = resolveProcessDispatcher({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
  })

  return await processPendingNotes(db, {
    workspaceId: membership.workspace_id,
    folderId,
    dispatcher,
  })
})
