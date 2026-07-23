import { getUserNotifications } from '~~/server/lib/notifications'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    if (!event.context.user)
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const userId = event.context.user.id
    const db = useDatabase(useRuntimeConfig(event))

    const membership = await db
      .selectFrom('memberships')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', userId)
      .where('deactivated_at', 'is', null)
      .executeTakeFirst()

    const notifications = await getUserNotifications(
      userId,
      membership?.workspace_id,
      membership?.role,
    )

    return notifications
  }
  catch (err: any) {
    console.error('Error fetching user notifications:', err)
    if (err.statusCode)
      throw err

    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch notifications' })
  }
})
