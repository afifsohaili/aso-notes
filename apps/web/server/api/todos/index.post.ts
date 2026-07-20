import { wsManager } from '~~/server/utils/ws-manager'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    if (!event.context.user)
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = event.context.user.id
    const body = await readBody(event)

    // Validation
    if (!body || typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Title is required' })
    }

    const db = useDatabase(useRuntimeConfig(event))

    const todo = await db
      .insertInto('todos')
      .values({
        user_id: userId,
        title: body.title.trim(),
        description: body.description ?? null,
        completed: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    // Broadcast to connected WebSocket clients
    wsManager.broadcastToUser(userId, 'todo.created', todo)

    setResponseStatus(event, 201)
    return todo
  }
  catch (err: any) {
    console.error('Error creating todo:', err)
    if (err.statusCode)
      throw err
    throw createError({ statusCode: 500, statusMessage: 'Failed to create todo' })
  }
})
