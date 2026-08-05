import type { ConsolidationJobData } from '../../lib/consolidation/worker-helpers'
import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { CONSOLIDATION_QUEUE_NAME, ConsolidationJob } from '../../lib/consolidation/job'
import { hasActiveOrWaitingConsolidationJob } from '../../lib/consolidation/queue-helpers'
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

  if (!process.env.NUXT_REDIS_URL) {
    throw createError({ statusCode: 503, statusMessage: 'Consolidation queue is not available without Redis' })
  }

  const queue = useQueue<ConsolidationJobData>(CONSOLIDATION_QUEUE_NAME)
  const busy = await hasActiveOrWaitingConsolidationJob(queue, workspaceId)
  if (busy) {
    throw createError({ statusCode: 409, statusMessage: 'A consolidation job is already active or waiting for this workspace' })
  }

  await ConsolidationJob.performLater({ workspaceId, mode: 'manual' }, { jobId: `consolidation:${workspaceId}` })

  return { enqueued: true, mode: 'manual' }
})
