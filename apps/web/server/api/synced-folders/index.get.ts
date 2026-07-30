import { useDatabase } from '~~/utils/db'

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
    return []
  }

  const rows = await db
    .selectFrom('synced_folders')
    .leftJoin('notes', join =>
      join
        .onRef('notes.synced_folder_id', '=', 'synced_folders.id'))
    .select([
      'synced_folders.id',
      'synced_folders.path',
      'synced_folders.created_at',
      'synced_folders.updated_at',
      eb => eb.fn.count('notes.id').as('note_count'),
    ])
    .where('synced_folders.workspace_id', '=', workspaceId)
    .groupBy([
      'synced_folders.id',
      'synced_folders.path',
      'synced_folders.created_at',
      'synced_folders.updated_at',
    ])
    .orderBy('synced_folders.created_at', 'asc')
    .execute()

  return rows.map(row => ({
    id: row.id,
    path: row.path,
    noteCount: Number(row.note_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }))
})
