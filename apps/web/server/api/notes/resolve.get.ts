import { useDatabase } from '~~/utils/db'
import { NotePathError, parseNoteRoutePath } from '../../lib/notes/paths'

async function resolveWorkspaceId(db: any, userId: string): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}

async function loadNoteByPath(db: any, workspaceId: string, syncedFolderId: string | null, notePath: string) {
  let q = db
    .selectFrom('notes')
    .select(['id', 'path', 'folder_id', 'synced_folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)

  if (syncedFolderId)
    q = q.where('synced_folder_id', '=', syncedFolderId)

  return q.executeTakeFirst()
}

async function loadFolderByPath(db: any, workspaceId: string, syncedFolderId: string | null, folderPath: string) {
  let q = db
    .selectFrom('folders')
    .select(['id', 'path', 'synced_folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', folderPath)

  if (syncedFolderId)
    q = q.where('synced_folder_id', '=', syncedFolderId)

  return q.executeTakeFirst()
}

async function loadFolderPath(db: any, workspaceId: string, folderId: string | null): Promise<string | null> {
  if (!folderId)
    return null
  const folder = await db
    .selectFrom('folders')
    .select('path')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', folderId)
    .executeTakeFirst()
  return folder?.path ?? null
}

async function loadSyncedFolderForPath(db: any, workspaceId: string, syncedFolderId: string | null, notePath: string) {
  if (syncedFolderId) {
    const folder = await db
      .selectFrom('synced_folders')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', syncedFolderId)
      .executeTakeFirst()
    return folder?.id ?? null
  }

  // No synced folder specified — fall back to the first root that owns this
  // path, ordered by creation, for backward-compatible resolution of old URLs.
  const note = await db
    .selectFrom('notes')
    .select('synced_folder_id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (note)
    return note.synced_folder_id

  const folder = await db
    .selectFrom('folders')
    .select('synced_folder_id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  return folder?.synced_folder_id ?? null
}

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const rawPath = typeof query.path === 'string' ? query.path : ''
  const syncedFolderId = typeof query.syncedFolder === 'string' ? query.syncedFolder : null

  if (!rawPath) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  let canonicalPath: string
  try {
    canonicalPath = parseNoteRoutePath(rawPath)
  }
  catch (err: any) {
    if (err instanceof NotePathError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }

  const normalizedPath = canonicalPath.replace(/\/+$/, '') || '/'

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)
  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const resolvedFolderId = await loadSyncedFolderForPath(db, workspaceId, syncedFolderId, normalizedPath)
  if (!resolvedFolderId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const note = await loadNoteByPath(db, workspaceId, resolvedFolderId, normalizedPath)
  if (note) {
    const folderPath = await loadFolderPath(db, workspaceId, note.folder_id)
    return {
      type: 'note',
      path: note.path,
      folder: folderPath,
      syncedFolderId: note.synced_folder_id,
    }
  }

  const folder = await loadFolderByPath(db, workspaceId, resolvedFolderId, normalizedPath)
  if (folder) {
    return {
      type: 'folder',
      path: folder.path,
      syncedFolderId: folder.synced_folder_id,
    }
  }

  throw createError({ statusCode: 404, statusMessage: 'Not found' })
})
