import type { CreateNotificationData } from '~~/server/lib/notifications'
import { getNotificationById, updateNotification } from '~~/server/lib/notifications'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    const body = await readBody(event)

    if (!id || Number.isNaN(Number(id)))
      throw createError({ statusCode: 400, statusMessage: 'Invalid notification ID' })

    const notificationId = Number(id)

    // Check if notification exists
    const existingNotification = await getNotificationById(notificationId)
    if (!existingNotification)
      throw createError({ statusCode: 404, statusMessage: 'Notification not found' })

    // Validate target_type if provided
    if (body.target_type && !['workspace', 'role'].includes(body.target_type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'target_type must be either "workspace" or "role"',
      })
    }

    // Validate type if provided
    if (body.type && !['info', 'warning', 'success', 'error'].includes(body.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'type must be one of: info, warning, success, error',
      })
    }

    const updateData: Partial<CreateNotificationData> = {}

    if (body.title !== undefined)
      updateData.title = body.title
    if (body.message !== undefined)
      updateData.message = body.message
    if (body.type !== undefined)
      updateData.type = body.type
    if (body.target_type !== undefined)
      updateData.target_type = body.target_type
    if (body.target_id !== undefined)
      updateData.target_id = body.target_id
    if (body.is_active !== undefined)
      updateData.is_active = body.is_active

    const updatedNotification = await updateNotification(notificationId, updateData)

    return updatedNotification
  }
  catch (err: any) {
    console.error('Error updating notification:', err)
    if (err.statusCode)
      throw err

    throw createError({ statusCode: 500, statusMessage: 'Failed to update notification' })
  }
})
