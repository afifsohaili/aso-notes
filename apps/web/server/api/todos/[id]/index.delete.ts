import { wsManager } from '~~/server/utils/ws-manager'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    if (!event.context.user)
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = event.context.user.id
    const todoId = Number.parseInt(getRouterParam(event, 'id') || '', 10)

    if (Number.isNaN(todoId)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid todo ID' })
    }

    const db = useDatabase(useRuntimeConfig(event))

    // Verify ownership
    const existing = await db
      .selectFrom('todos')
      .select('id')
      .where('id', '=', todoId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (!existing) {
      // Check if it exists at all (to distinguish 404 vs 403)
      const anyTodo = await db
        .selectFrom('todos')
        .select('id')
        .where('id', '=', todoId)
        .executeTakeFirst()

      if (!anyTodo) {
        throw createError({ statusCode: 404, statusMessage: 'Todo not found' })
      }
      throw createError({ statusCode: 403, statusMessage: 'Not authorized to delete this todo' })
    }

    await db
      .deleteFrom('todos')
      .where('id', '=', todoId)
      .execute()

    // Broadcast to connected WebSocket clients
    wsManager.broadcastToUser(userId, 'todo.deleted', { id: todoId })

    return { success: true }
  }
  catch (err: any) {
    console.error('Error deleting todo:', err)
    if (err.statusCode)
      throw err
    throw createError({ statusCode: 500, statusMessage: 'Failed to delete todo' })
  }
})
