import { markAllNotificationsAsRead, markNotificationsAsRead } from '~~/server/lib/notifications'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const userId = event.context.user.id
    const db = useDatabase(useRuntimeConfig(event))

    // Get user's workspace and role from membership
    const membership = await db
      .selectFrom('memberships')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', userId)
      .where('deactivated_at', 'is', null)
      .executeTakeFirst()

    if (body.mark_all === true) {
      // Mark all notifications as read
      await markAllNotificationsAsRead(
        userId,
        membership?.workspace_id,
        membership?.role,
      )

      return { success: true, message: 'All notifications marked as read' }
    }
    else if (body.notification_ids && Array.isArray(body.notification_ids)) {
      // Mark specific notifications as read
      const notificationIds = body.notification_ids.filter((id: any) =>
        typeof id === 'number' && !Number.isNaN(id),
      )

      if (notificationIds.length === 0)
        throw createError({ statusCode: 400, statusMessage: 'No valid notification IDs provided' })

      await markNotificationsAsRead(notificationIds, userId)

      return {
        success: true,
        message: `${notificationIds.length} notification(s) marked as read`,
        marked_count: notificationIds.length,
      }
    }
    else {
      throw createError({
        statusCode: 400,
        statusMessage: 'Either mark_all: true or notification_ids array is required',
      })
    }
  }
  catch (err: any) {
    console.error('Error marking notifications as read:', err)
    if (err.statusCode)
      throw err

    throw createError({ statusCode: 500, statusMessage: 'Failed to mark notifications as read' })
  }
})
