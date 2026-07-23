import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig(event)
    const db = useDatabase({ databaseUrl: config.databaseUrl })

    // Fetch all workspaces for admin targeting
    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'created_at'])
      .orderBy('name', 'asc')
      .execute()

    return workspaces
  }
  catch (err: any) {
    console.error('Error fetching workspaces:', err)
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch workspaces' })
  }
})
