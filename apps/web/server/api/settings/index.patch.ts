import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'
import { clearAgentProviders } from '../../lib/agent/providers'
import { clearStageRegistry } from '../../lib/pipeline/singleton'
import { assertKnownSettingKey, isLLMSettingKey, normalizeSettingValue } from '../../lib/settings'

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

  const body = await readBody(event)

  try {
    const key = assertKnownSettingKey(body?.key)
    const value = normalizeSettingValue(key, body?.value)

    const valueSql = typeof value === 'string'
      ? sql`to_jsonb(${value}::text)`
      : sql`to_jsonb(${value}::numeric)`

    await db
      .insertInto('workspace_settings')
      .values({
        workspace_id: workspaceId,
        key,
        value: valueSql,
      })
      .onConflict(oc => oc.columns(['workspace_id', 'key']).doUpdateSet({
        value: valueSql,
      }))
      .execute()

    if (isLLMSettingKey(key)) {
      clearStageRegistry()
      clearAgentProviders()
    }
  }
  catch (err) {
    if (err instanceof Error) {
      throw createError({ statusCode: 400, message: err.message })
    }
    throw err
  }

  return { ok: true }
})
