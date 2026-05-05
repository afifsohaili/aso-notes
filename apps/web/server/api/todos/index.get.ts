import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    if (!event.context.user)
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = event.context.user.id
    const db = useDatabase(useRuntimeConfig(event))

    const todos = await db
      .selectFrom('todos')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute()

    return todos
  }
  catch (err: any) {
    console.error('Error fetching todos:', err)
    if (err.statusCode)
      throw err
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch todos' })
  }
})
