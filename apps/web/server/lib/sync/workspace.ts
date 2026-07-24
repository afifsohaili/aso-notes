import type { SyncDb } from './sweeper'

/**
 * Workspace resolution for the sync service. Sync is single-tenant MVP: the
 * whole notes dir belongs to the first workspace in the database. Recorded
 * as an M3 divergence note in plan-002-system.
 */
export async function resolveSyncWorkspace(db: SyncDb): Promise<string | null> {
  const row = await db
    .selectFrom('workspaces')
    .select('id')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst()
  return row?.id ?? null
}
