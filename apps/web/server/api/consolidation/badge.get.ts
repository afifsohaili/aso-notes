import { useDatabase } from '~~/utils/db'
import { getWorkspaceSetting } from '../../lib/settings'
import { resolveWorkspaceId } from '../../utils/workspace'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    return { badge: false, latestRunId: null }
  }

  const run = await db
    .selectFrom('consolidation_runs')
    .select(['id', 'status', 'flags'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!run || run.status === 'running') {
    return { badge: false, latestRunId: run?.id ?? null }
  }

  const flags = run.flags as { overPruning?: boolean, ineffectiveness?: boolean } | null
  const flagged = flags?.overPruning || flags?.ineffectiveness

  if (run.status !== 'failed' && !flagged) {
    return { badge: false, latestRunId: run.id }
  }

  const seenRunId = await getWorkspaceSetting<string | null>(db, workspaceId, 'consolidation.badge_seen_run_id', null)
  return { badge: run.id !== seenRunId, latestRunId: run.id }
})
