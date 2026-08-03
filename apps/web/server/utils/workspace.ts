import type { GraphDb } from '../lib/graph/age'

/**
 * Resolve the first (oldest) workspace a user is a member of. Mirrors the
 * per-endpoint helper historically inlined in every handler; extracted so
 * the graph API handlers share one implementation.
 */
export async function resolveWorkspaceId(db: GraphDb, userId: string): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}
