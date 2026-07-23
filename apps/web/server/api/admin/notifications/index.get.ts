import type { AdminNotificationFilters } from '~~/server/lib/notifications'
import { getAdminNotifications } from '~~/server/lib/notifications'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)

    const filters: AdminNotificationFilters = {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit === 'all' ? 'all' : (query.limit ? Number(query.limit) : 25),
      type: query.type as 'info' | 'warning' | 'success' | 'error' | undefined,
      target_type: query.target_type as 'workspace' | 'role' | undefined,
      is_active: query.is_active !== undefined ? query.is_active === 'true' : undefined,
      search: query.search as string | undefined,
    }

    const result = await getAdminNotifications(filters)

    return result
  }
  catch (err: any) {
    console.error('Error fetching notifications:', err)
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch notifications' })
  }
})
