import { useAuth } from '~~/utils/auth'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  const auth = useAuth(useRuntimeConfig(event))
  const db = useDatabase(useRuntimeConfig(event))
  const session = await auth.api.getSession({
    headers: event.headers,
  })

  if (!session || !session.user)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const [workspace] = await db
    .selectFrom('workspaces')
    .innerJoin('memberships', 'workspaces.id', 'memberships.workspace_id')
    .where('memberships.user_id', '=', session.user.id)
    .select([
      'workspaces.id',
      'workspaces.name',
      'workspaces.created_at',
      'workspaces.updated_at',
      'memberships.role',
    ])
    .limit(1)
    .execute()

  return workspace
})
