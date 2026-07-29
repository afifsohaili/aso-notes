import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
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
    return { pending: 0, ingested: 0, failed: 0 }
  }

  const rows = await db
    .selectFrom('notes')
    .select(['status', eb => eb.fn.count('id').as('c')])
    .where('workspace_id', '=', membership.workspace_id)
    .groupBy('status')
    .execute()

  const counts = { pending: 0, ingested: 0, failed: 0 }
  for (const row of rows) {
    if (row.status === 'pending' || row.status === 'ingested' || row.status === 'failed')
      counts[row.status] = Number(row.c)
  }

  return counts
})
