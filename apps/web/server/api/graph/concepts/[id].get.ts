import { useDatabase } from '~~/utils/db'
import { getConceptDetail } from '../../../lib/graph/ui'

async function resolveWorkspaceId(db: any, userId: string): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const conceptId = getRouterParam(event, 'id')
  if (!conceptId) {
    throw createError({ statusCode: 400, statusMessage: 'Concept id is required' })
  }

  const detail = await getConceptDetail(db, workspaceId, conceptId)
  if (!detail) {
    throw createError({ statusCode: 404, statusMessage: 'Concept not found' })
  }

  return detail
})
