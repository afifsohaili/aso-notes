import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { IngestionDispatcher } from './dispatcher'
import { sql } from 'kysely'
import { recordSweeperHeartbeat } from './sweeper-state'

/**
 * Sweeper: the sync service's slow path (plan-002-system §Sync service).
 * Notes sit at status='pending' after the fast-path upsert; once untouched
 * for the settle interval the sweeper dispatches ingestion. Notes that are
 * 'queued' but untouched for the same interval are also re-dispatched so a
 * Redis flush or orphaned queue row does not leave them stuck.
 */

/** How often the sweeper runs (named constant per plan). */
export const SWEEP_INTERVAL_MS = 30_000

/** How long a pending/queued note must be untouched before ingestion is (re-)dispatched. */
export const PENDING_SETTLE_INTERVAL = '5 minutes'

export type SyncDb = Kysely<DB> | Transaction<DB>

/**
 * Notes that are ready for the sweeper to dispatch: either pending or queued,
 * but only once they have been untouched for the settle interval. We
 * deliberately do NOT re-dispatch 'processing' notes — BullMQ's stalled-job
 * recovery owns those.
 */
export function settledPendingNotesQuery(db: SyncDb, workspaceId: string) {
  return db
    .selectFrom('notes')
    .select(['id', 'path'])
    .where('workspace_id', '=', workspaceId)
    .where('status', 'in', ['pending', 'queued'])
    .where(sql`updated_at < now() - interval ${sql.lit(PENDING_SETTLE_INTERVAL)}`)
}

export interface SweepResult {
  /** Note ids successfully handed to the dispatcher. */
  dispatched: string[]
  /** Note ids whose dispatch (or inline run) threw — sweep continues past them. */
  failed: string[]
}

/**
 * One sweeper pass: find settled pending/queued notes and dispatch ingestion
 * for each. Per-note dispatch errors are logged and collected so one bad note
 * never blocks the rest of the batch. Records the heartbeat for O6 diagnostics.
 */
export async function runSweeperOnce(args: {
  db: SyncDb
  workspaceId: string
  dispatcher: IngestionDispatcher
}): Promise<SweepResult> {
  const { db, workspaceId, dispatcher } = args
  const settled = await settledPendingNotesQuery(db, workspaceId).execute()

  const result: SweepResult = { dispatched: [], failed: [] }
  for (const note of settled) {
    try {
      await dispatcher.dispatch(note.id)
      result.dispatched.push(note.id)
    }
    catch (error) {
      console.error(`notes-sweeper: dispatch failed for note ${note.id} (${note.path}):`, error)
      result.failed.push(note.id)
    }
  }

  recordSweeperHeartbeat(result)
  return result
}
