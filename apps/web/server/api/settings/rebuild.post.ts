import process from 'node:process'
import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'
import { rebuildWorkspaceGraph } from '../../lib/rebuild'
import { INGESTION_QUEUE_NAME, purgeIngestionJobs } from '../../lib/sync/dispatcher'
import { useQueue } from '../../utils/queue'

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

  // Captured up front so the post-rebuild queue purge covers every note,
  // not only the ones whose status changed.
  const noteIds = (await db
    .selectFrom('notes')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .execute()).map(row => row.id)

  let result
  if (db.isTransaction) {
    await sql`SAVEPOINT rebuild_graph`.execute(db)
    try {
      result = await rebuildWorkspaceGraph(db, workspaceId)
    }
    catch (error) {
      await sql`ROLLBACK TO SAVEPOINT rebuild_graph`.execute(db)
      throw error
    }
  }
  else {
    result = await db.transaction().execute(trx => rebuildWorkspaceGraph(trx, workspaceId))
  }

  // Rebuild resets notes to pending, but BullMQ's jobId=noteId dedupe makes
  // re-dispatch a silent no-op while any job lingers (failed jobs are kept
  // for 7 days) — purge them so the re-ingestion actually reaches a worker.
  // Queue ops sit outside the DB transaction on purpose: purging must only
  // happen after the wipe commits.
  let jobsPurged = 0
  if (process.env.NUXT_REDIS_URL && noteIds.length > 0) {
    const queue = useQueue(INGESTION_QUEUE_NAME)
    jobsPurged = await purgeIngestionJobs(queue, noteIds)
  }

  return { ...result, jobsPurged }
})
