import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'

const MAX_ALIAS_LENGTH = 80

async function resolveWorkspaceId(db: any, userId: string): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}

/**
 * Trim a user-provided alias. Empty or whitespace-only strings become null.
 * Returns null for null/undefined input.
 */
function normalizeAlias(alias: unknown): string | null {
  if (alias === null || alias === undefined)
    return null
  if (typeof alias !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Alias must be a string or null' })
  }
  const trimmed = alias.trim()
  if (trimmed.length === 0)
    return null
  if (trimmed.length > MAX_ALIAS_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `Alias must be at most ${MAX_ALIAS_LENGTH} characters` })
  }
  return trimmed
}

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Synced folder not found' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'No workspace found for user' })
  }

  const folder = await db
    .selectFrom('synced_folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst()

  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: 'Synced folder not found' })
  }

  const body = await readBody(event)
  const alias = normalizeAlias(body?.alias)

  const updated = await db
    .updateTable('synced_folders')
    .set({ alias, updated_at: sql`now()` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow()

  return {
    id: updated.id,
    path: updated.path,
    alias: updated.alias,
    createdAt: updated.created_at.toISOString(),
    updatedAt: updated.updated_at.toISOString(),
  }
})
