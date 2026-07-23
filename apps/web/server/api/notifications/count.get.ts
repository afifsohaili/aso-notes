import { getUnreadNotificationCount } from '~~/server/lib/notifications'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)

    const userId = event.context.user.id
    const db = useDatabase(useRuntimeConfig(event))

    // Get user's workspace and role from membership
    const membership = await db
      .selectFrom('memberships')
      .select(['workspace_id', 'role'])
      .where('user_id', '=', userId)
      .where('deactivated_at', 'is', null)
      .executeTakeFirst()

    const unreadOnly = query.unread === 'true'

    if (unreadOnly) {
      const count = await getUnreadNotificationCount(
        userId,
        membership?.workspace_id,
        membership?.role,
      )

      return { unread_count: count }
    }
    else {
      // Get total count of all notifications for the user
      const notifications = await db
        .selectFrom('notifications as n')
        .select(eb => eb.fn.countAll().as('count'))
        .where('n.is_active', '=', true)
        .where((eb) => {
          const conditions = []

          if (membership?.workspace_id) {
            conditions.push(
              eb.and([
                eb('n.target_type', '=', 'workspace'),
                eb('n.target_id', '=', membership.workspace_id),
              ]),
            )
          }

          if (membership?.role) {
            conditions.push(
              eb.and([
                eb('n.target_type', '=', 'role'),
                eb('n.target_id', '=', membership.role),
              ]),
            )
          }

          return eb.or(conditions)
        })
        .executeTakeFirst()

      const totalCount = Number(notifications?.count || 0)

      const unreadCount = await getUnreadNotificationCount(
        userId,
        membership?.workspace_id,
        membership?.role,
      )

      return {
        total_count: totalCount,
        unread_count: unreadCount,
        read_count: totalCount - unreadCount,
      }
    }
  }
  catch (err: any) {
    console.error('Error fetching notification count:', err)
    if (err.statusCode)
      throw err

    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch notification count' })
  }
})
