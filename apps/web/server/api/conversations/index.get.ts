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
  const archivedOnly = query.archived === 'true'

  const conversations = await db
    .selectFrom('conversations')
    .select(['id', 'title', 'created_at', 'updated_at'])
    .where('workspace_id', '=', membership.workspace_id)
    .where('archived_at', archivedOnly ? 'is not' : 'is', null)
    .orderBy('updated_at', 'desc')
    .execute()

  return conversations
})
