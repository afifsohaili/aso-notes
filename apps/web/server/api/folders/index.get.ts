import { useDatabase } from '~~/utils/db'
import { computePathPrefixes, rootNameFor } from '../../lib/notes/disambiguation'
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

  const syncedFolders = await db
    .selectFrom('synced_folders')
    .select(['id', 'path', 'alias', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'asc')
    .execute()

  if (syncedFolders.length === 0) {
    return []
  }

  const pathPrefixById = computePathPrefixes(
    syncedFolders.map(sf => ({ id: sf.id, path: sf.path, alias: sf.alias })),
  )

  const syncedFolderIds = syncedFolders.map(sf => sf.id)

  const folders = await db
    .selectFrom('folders')
    .leftJoin('notes', join =>
      join
        .onRef('notes.synced_folder_id', '=', 'folders.synced_folder_id')
        .onRef('notes.folder_id', '=', 'folders.id'))
    .select([
      'folders.synced_folder_id',
      'folders.path',
      'folders.cover_hash',
      eb => eb.fn.count('notes.id').as('note_count'),
    ])
    .where('folders.workspace_id', '=', workspaceId)
    .where('folders.path', '<>', '/')
    .where('folders.synced_folder_id', 'in', syncedFolderIds)
    .groupBy(['folders.id', 'folders.synced_folder_id', 'folders.path', 'folders.cover_hash'])
    .orderBy('folders.path')
    .execute()

  const rootCounts = await db
    .selectFrom('notes')
    .select(['synced_folder_id', eb => eb.fn.count('id').as('note_count')])
    .where('workspace_id', '=', workspaceId)
    .where('folder_id', 'is', null)
    .where('synced_folder_id', 'in', syncedFolderIds)
    .groupBy('synced_folder_id')
    .execute()

  const rootCountByFolder = new Map(rootCounts.map(r => [r.synced_folder_id, Number(r.note_count)]))

  const rootCovers = await db
    .selectFrom('folders')
    .select(['synced_folder_id', 'cover_hash'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', '/')
    .where('synced_folder_id', 'in', syncedFolderIds)
    .execute()

  const rootCoverByFolder = new Map(rootCovers.map(r => [r.synced_folder_id, r.cover_hash !== null]))

  const foldersBySyncedFolder = new Map<string, typeof folders>()
  for (const folder of folders) {
    const list = foldersBySyncedFolder.get(folder.synced_folder_id) ?? []
    list.push(folder)
    foldersBySyncedFolder.set(folder.synced_folder_id, list)
  }

  return syncedFolders.map((sf) => {
    const sfFolders = foldersBySyncedFolder.get(sf.id) ?? []
    const children = buildFolderTree(sfFolders.map(f => ({
      path: f.path,
      hasCover: f.cover_hash !== null,
      noteCount: Number(f.note_count),
    })))

    return {
      syncedFolderId: sf.id,
      name: rootNameFor(sf.path, sf.alias),
      pathPrefix: pathPrefixById.get(sf.id) ?? null,
      absolutePath: sf.path,
      hasCover: rootCoverByFolder.get(sf.id) ?? false,
      noteCount: rootCountByFolder.get(sf.id) ?? 0,
      children,
    }
  })
})
