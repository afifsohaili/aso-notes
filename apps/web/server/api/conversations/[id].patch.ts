import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Conversation id is required' })
  }

  const body = await readBody(event)
  if (typeof body?.archived !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'archived (boolean) is required' })
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
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  const updated = await db
    .updateTable('conversations')
    .set({ archived_at: body.archived ? sql`now()` : null })
    .where('id', '=', id)
    .where('workspace_id', '=', membership.workspace_id)
    .returning(['id', 'archived_at'])
    .executeTakeFirst()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  return updated
})
