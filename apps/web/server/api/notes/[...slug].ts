import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { isTagDeleteRoute, isTagsRoute, NotePathError, parseNoteRouteSegments, parseTagDeleteRoute, parseTagsRoute } from '../../lib/notes/paths'
import { addTagToNote, removeTagFromNote } from '../../lib/notes/tags'
import { handleFileUpsert } from '../../lib/sync/files'

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
    .select(['id', 'path', 'title', 'content', 'status', 'updated_at', 'folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .executeTakeFirst()
}

async function loadNoteTags(db: any, workspaceId: string, noteId: string) {
  return db
    .selectFrom('note_tags')
    .innerJoin('tags', 'tags.id', 'note_tags.tag_id')
    .select(['tags.id', 'tags.name', 'note_tags.origin'])
    .where('note_tags.workspace_id', '=', workspaceId)
    .where('note_tags.note_id', '=', noteId)
    .execute()
}

async function loadNoteSources(db: any, workspaceId: string, noteId: string) {
  return db
    .selectFrom('sources')
    .select(['url', 'type'])
    .where('workspace_id', '=', workspaceId)
    .where('note_id', '=', noteId)
    .execute()
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

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)
  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const pathname = getRequestURL(event).pathname
  const prefix = '/api/notes/'
  const slug = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  const segments = slug.split('/').filter(Boolean)

  try {
    if (event.method === 'POST' && isTagsRoute(segments)) {
      const notePath = parseTagsRoute(segments)
      const note = await loadNoteByPath(db, workspaceId, notePath)
      if (!note) {
        throw createError({ statusCode: 404, statusMessage: 'Note not found' })
      }
      const body = await readBody(event)
      const tag = await addTagToNote(db, { workspaceId, noteId: note.id, tagName: body.name })
      return tag
    }

    if (event.method === 'DELETE' && isTagDeleteRoute(segments)) {
      const { notePath, tagId } = parseTagDeleteRoute(segments)
      const note = await loadNoteByPath(db, workspaceId, notePath)
      if (!note) {
        throw createError({ statusCode: 404, statusMessage: 'Note not found' })
      }
      await removeTagFromNote(db, { workspaceId, noteId: note.id, tagId })
      return { ok: true }
    }

    const notePath = parseNoteRouteSegments(segments)

    if (event.method === 'PUT') {
      // PUT creates or updates: write the file, upsert the row (pending), return it
      const body = await readBody(event)
      const content = typeof body.content === 'string' ? body.content : ''
      const notesDir = config.notesDir || process.env.NUXT_NOTES_DIR || './notes'
      const absolutePath = path.join(notesDir, ...segments)
      mkdirSync(path.dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, content)

      await handleFileUpsert({ db, workspaceId, notesDir, absolutePath })

      const updated = await loadNoteByPath(db, workspaceId, notePath)
      if (!updated) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to update note' })
      }
      return {
        id: updated.id,
        path: updated.path,
        title: updated.title,
        content: updated.content,
        status: updated.status,
        updatedAt: updated.updated_at.toISOString(),
      }
    }

    const note = await loadNoteByPath(db, workspaceId, notePath)
    if (!note) {
      throw createError({ statusCode: 404, statusMessage: 'Note not found' })
    }

    if (event.method === 'GET') {
      const [tags, sources, folderPath] = await Promise.all([
        loadNoteTags(db, workspaceId, note.id),
        loadNoteSources(db, workspaceId, note.id),
        loadFolderPath(db, workspaceId, note.folder_id),
      ])

      return {
        path: note.path,
        title: note.title,
        content: note.content,
        renderMarkdown: true,
        status: note.status,
        folder: folderPath,
        tags,
        sources,
        updatedAt: note.updated_at.toISOString(),
      }
    }

    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }
  catch (err: any) {
    if (err instanceof NotePathError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
