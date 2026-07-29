import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'
import { rebuildWorkspaceGraph } from '../../lib/rebuild'

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

  if (db.isTransaction) {
    await sql`SAVEPOINT rebuild_graph`.execute(db)
    try {
      const result = await rebuildWorkspaceGraph(db, workspaceId)
      return result
    }
    catch (error) {
      await sql`ROLLBACK TO SAVEPOINT rebuild_graph`.execute(db)
      throw error
    }
  }

  const result = await db.transaction().execute(trx => rebuildWorkspaceGraph(trx, workspaceId))
  return result
})
