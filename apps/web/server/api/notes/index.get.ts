import { parseLastRun, toLastRunSummary } from '~~/server/lib/pipeline/last-run'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)

  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', event.context.user.id)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!membership) {
    return []
  }

  const query = getQuery(event)
  const folder = typeof query.folder === 'string' ? query.folder : ''
  const workspaceId = membership.workspace_id

  let noteQuery = db
    .selectFrom('notes')
    .select(['id', 'path', 'title', 'status', 'updated_at', 'last_run'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('updated_at', 'desc')

  if (folder && folder !== '/') {
    const folderRow = await db
      .selectFrom('folders')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', folder)
      .executeTakeFirst()

    if (!folderRow) {
      return []
    }

    noteQuery = noteQuery.where('folder_id', '=', folderRow.id)
  }
  else {
    noteQuery = noteQuery.where('folder_id', 'is', null)
  }

  const notes = await noteQuery.execute()
  const noteIds = notes.map(n => n.id)

  const tags = noteIds.length > 0
    ? await db
        .selectFrom('note_tags')
        .innerJoin('tags', 'tags.id', 'note_tags.tag_id')
        .select(['note_tags.note_id as note_id', 'tags.id', 'tags.name', 'note_tags.origin'])
        .where('note_tags.workspace_id', '=', workspaceId)
        .where('note_tags.note_id', 'in', noteIds)
        .execute()
    : []

  const tagsByNote = new Map<string, { id: string, name: string, origin: string }[]>()
  for (const tag of tags) {
    const list = tagsByNote.get(tag.note_id) ?? []
    list.push({ id: tag.id, name: tag.name, origin: tag.origin })
    tagsByNote.set(tag.note_id, list)
  }

  return notes.map((n) => {
    const parsed = parseLastRun(n.last_run)
    return {
      path: n.path,
      title: n.title,
      status: n.status,
      tags: tagsByNote.get(n.id) ?? [],
      updatedAt: n.updated_at.toISOString(),
      lastRun: parsed ? toLastRunSummary(parsed) : null,
    }
  })
})
