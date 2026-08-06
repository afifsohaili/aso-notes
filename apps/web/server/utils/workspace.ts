import type { Kysely, Transaction } from 'kysely'

/**
 * Resolve the caller's workspace: the earliest membership wins (single-
 * workspace product assumption shared by all consolidation endpoints).
 */
export async function resolveWorkspaceId(
  db: Kysely<Database> | Transaction<Database>,
  userId: string,
): Promise<string | null> {
  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
  return membership?.workspace_id ?? null
}
