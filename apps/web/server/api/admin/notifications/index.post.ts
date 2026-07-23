import type { CreateNotificationData } from '~~/server/lib/notifications'
import { createNotification } from '~~/server/lib/notifications'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    const user = event.context.user

    // Validate required fields
    if (!body.title || !body.message || !body.target_type) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: title, message, target_type',
      })
    }

    // Validate target_type
    if (!['workspace', 'role'].includes(body.target_type)) {
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

    const notificationData: CreateNotificationData = {
      title: body.title,
      message: body.message,
      type: body.type || 'info',
      target_type: body.target_type,
      target_id: body.target_id || null,
      created_by: user.id,
      is_active: body.is_active ?? true,
    }

    const notification = await createNotification(notificationData)

    return notification
  }
  catch (err: any) {
    console.error('Error creating notification:', err)
    if (err.statusCode)
      throw err

    throw createError({ statusCode: 500, statusMessage: 'Failed to create notification' })
  }
})
