import { useDatabase } from '~~/utils/db'
import { getSmokeTestState } from '../../lib/onboarding/smoke-test'

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
    throw createError({ statusCode: 400, statusMessage: 'No workspace found for user' })
  }

  const query = getQuery(event)
  const attemptId = query.attemptId
  if (typeof attemptId !== 'string' || attemptId.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'attemptId query parameter is required' })
  }

  const state = await getSmokeTestState(db, workspaceId, attemptId)

  if ('code' in state) {
    setResponseStatus(event, 409)
    return { code: state.code, message: state.message }
  }

  return {
    attemptId,
    phase: state.phase,
    ...(state.error ? { error: state.error } : {}),
    ...(state.lastRun ? { lastRun: state.lastRun } : {}),
  }
})
