/**
 * Admin middleware - protects all /api/admin/* routes
 * Admin is defined as the user with email afifnajib@gmail.com
 */
export default defineEventHandler(async (event) => {
  // Only process admin API routes
  if (!event.path.startsWith('/api/admin'))
    return

  // Check authentication first
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized',
    })
  }

  // Check if user is admin (afifnajib@gmail.com)
  if (event.context.user.email !== 'afifnajib@gmail.com') {
    throw createError({
      statusCode: 403,
      message: 'Forbidden - Admin access required',
    })
  }
})
