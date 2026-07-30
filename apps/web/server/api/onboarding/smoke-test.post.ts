import { useDatabase } from '~~/utils/db'
import { startSmokeTest } from '../../lib/onboarding/smoke-test'

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

  const result = await startSmokeTest(db, workspaceId)

  if ('code' in result) {
    setResponseStatus(event, 409)
    return { code: result.code, message: result.message }
  }

  return {
    attemptId: result.attempt.attemptId,
    phase: 'written' as const,
  }
})
