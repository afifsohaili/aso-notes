import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { IngestionQueueSnapshot } from './queue'
import type { SweeperState } from './sweeper-state'

export interface IngestionStatusResponse {
  db: {
    pending: number
    queued: number
    processing: number
    ingested: number
    failed: number
  }
  queue: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  } | null
  activeJobs: {
    id: string
    path: string
    title: string | null
  }[]
  sweeper: SweeperState
}

export interface BuildIngestionStatusArgs {
  db: Kysely<Database>
  workspaceId: string
  queue: IngestionQueueSnapshot | null
  sweeperState: SweeperState
}

/**
 * Assemble the ingestion status payload for a workspace.
 *
 * When no queue is available (NUXT_REDIS_URL unset), `queue` is `null` and
 * `activeJobs` is empty. Active jobs whose note id cannot be resolved to a
 * note in the workspace are silently skipped so the endpoint never leaks
 * another workspace's paths.
 */
export async function buildIngestionStatus(args: BuildIngestionStatusArgs): Promise<IngestionStatusResponse> {
  const { db, workspaceId, queue, sweeperState } = args

  const rows = await db
    .selectFrom('notes')
    .select(['status', eb => eb.fn.count('id').as('c')])
    .where('workspace_id', '=', workspaceId)
    .groupBy('status')
    .execute()

  const dbCounts: IngestionStatusResponse['db'] = {
    pending: 0,
    queued: 0,
    processing: 0,
    ingested: 0,
    failed: 0,
  }
  for (const row of rows) {
    if (row.status in dbCounts) {
      dbCounts[row.status as keyof IngestionStatusResponse['db']] = Number(row.c)
    }
  }

  let queueCounts: IngestionStatusResponse['queue'] = null
  const activeJobs: IngestionStatusResponse['activeJobs'] = []

  if (queue) {
    queueCounts = await queue.getJobCounts()
    const active = await queue.getActiveJobs()
    const activeNoteIds = active.map(job => job.id).filter(Boolean)

    if (activeNoteIds.length > 0) {
      const notes = await db
        .selectFrom('notes')
        .select(['id', 'path', 'title'])
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', activeNoteIds)
        .execute()
      const noteById = new Map(notes.map(n => [n.id, n]))

      for (const job of active) {
        const note = noteById.get(job.id)
        if (!note)
          continue
        activeJobs.push({
          id: job.id,
          path: note.path,
          title: note.title,
        })
      }
    }
  }

  return {
    db: dbCounts,
    queue: queueCounts,
    activeJobs,
    sweeper: sweeperState,
  }
}
