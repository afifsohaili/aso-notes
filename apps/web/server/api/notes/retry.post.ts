import { sql } from 'kysely'
import { resolveProcessDispatcher } from '~~/server/lib/sync/process'
import { useDatabase } from '~~/utils/db'

/**
 * Retry a single failed note (plan-002-system §Sync service): flip it back to
 * pending and dispatch ingestion immediately. Only failed notes are eligible —
 * pending notes are already queued and ingested notes would need a content
 * change to justify reprocessing.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const notePath = typeof body?.path === 'string' ? body.path : null
  if (!notePath) {
    throw createError({ statusCode: 400, statusMessage: 'path is required' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)

  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', event.context.user.id)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!membership) {
    throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  }

  const note = await db
    .selectFrom('notes')
    .select(['id', 'status'])
    .where('workspace_id', '=', membership.workspace_id)
    .where('path', '=', notePath)
    .executeTakeFirst()

  if (!note) {
    throw createError({ statusCode: 404, statusMessage: 'Note not found' })
  }

  if (note.status !== 'failed') {
    throw createError({ statusCode: 400, statusMessage: 'Only failed notes can be retried' })
  }

  await db
    .updateTable('notes')
    .set({ status: 'pending', updated_at: sql`now()` })
    .where('id', '=', note.id)
    .execute()

  const dispatcher = resolveProcessDispatcher({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
  })
  await dispatcher.dispatch(note.id)

  return { ok: true, id: note.id, path: notePath }
})
