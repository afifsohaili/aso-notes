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

async function loadNoteByPath(db: any, workspaceId: string, notePath: string) {
  return db
    .selectFrom('notes')
    .select(['id', 'path', 'folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .executeTakeFirst()
}

async function loadFolderByPath(db: any, workspaceId: string, folderPath: string) {
  return db
    .selectFrom('folders')
    .select(['id', 'path'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', folderPath)
    .executeTakeFirst()
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

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const rawPath = typeof query.path === 'string' ? query.path : ''

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

  const note = await loadNoteByPath(db, workspaceId, normalizedPath)
  if (note) {
    const folderPath = await loadFolderPath(db, workspaceId, note.folder_id)
    return {
      type: 'note',
      path: note.path,
      folder: folderPath,
    }
  }

  const folder = await loadFolderByPath(db, workspaceId, normalizedPath)
  if (folder) {
    return {
      type: 'folder',
      path: folder.path,
    }
  }

  throw createError({ statusCode: 404, statusMessage: 'Not found' })
})
