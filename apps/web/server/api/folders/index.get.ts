import { useDatabase } from '~~/utils/db'
import { buildFolderTree } from '../../lib/notes/tree'

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

  const workspaceId = membership.workspace_id

  const folders = await db
    .selectFrom('folders')
    .leftJoin('notes', join =>
      join
        .onRef('notes.workspace_id', '=', 'folders.workspace_id')
        .onRef('notes.folder_id', '=', 'folders.id'))
    .select([
      'folders.path',
      'folders.cover_hash',
      eb => eb.fn.count('notes.id').as('note_count'),
    ])
    .where('folders.workspace_id', '=', workspaceId)
    .groupBy(['folders.id', 'folders.path', 'folders.cover_hash'])
    .orderBy('folders.path')
    .execute()

  const tree = buildFolderTree(folders.map(f => ({
    path: f.path,
    hasCover: f.cover_hash !== null,
    noteCount: Number(f.note_count),
  })))

  return tree
})
