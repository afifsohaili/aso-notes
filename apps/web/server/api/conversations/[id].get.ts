import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Conversation id is required' })
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

  const conversation = await db
    .selectFrom('conversations')
    .select(['id', 'title', 'created_at', 'updated_at'])
    .where('id', '=', id)
    .where('workspace_id', '=', membership.workspace_id)
    .executeTakeFirst()

  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  const messages = await db
    .selectFrom('messages')
    .select(['id', 'role', 'content', 'tool_calls', 'tool_call_id', 'created_at'])
    .where('conversation_id', '=', id)
    .where('workspace_id', '=', membership.workspace_id)
    .orderBy('created_at', 'asc')
    .execute()

  return {
    ...conversation,
    messages: messages.map(m => ({
      ...m,
      tool_calls: m.tool_calls,
    })),
  }
})
