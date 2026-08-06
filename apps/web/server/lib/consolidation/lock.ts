import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'

/**
 * Thrown when a consolidation mutation (run or restore) is attempted while
 * another session already holds the workspace's consolidation lock.
 * Callers map this to a 409 (API) or a quiet skip (cron/worker).
 */
export class ConsolidationLockConflictError extends Error {
  readonly workspaceId: string

  constructor(workspaceId: string) {
    super(`A consolidation operation is already in progress for workspace ${workspaceId}`)
    this.name = 'ConsolidationLockConflictError'
    this.workspaceId = workspaceId
  }
}

/**
 * Try to take the per-workspace Postgres advisory lock for the rest of the
 * current transaction (`pg_try_advisory_xact_lock` keyed on
 * `hashtext(workspaceId)`). Guarantees at most one consolidation mutation in
 * flight per workspace.
 *
 * Must be called inside a transaction (or a host transaction in tests) —
 * outside one the lock would be released as soon as the statement completes.
 * Throws ConsolidationLockConflictError when another session holds the lock.
 */
export async function acquireConsolidationLock(
  db: Kysely<DB> | Transaction<DB>,
  workspaceId: string,
): Promise<void> {
  const result = await sql<{ locked: boolean }>`
    SELECT pg_try_advisory_xact_lock(hashtext(${workspaceId})) AS locked
  `.execute(db)

  if (!result.rows[0]?.locked)
    throw new ConsolidationLockConflictError(workspaceId)
}
