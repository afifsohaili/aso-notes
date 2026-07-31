import type { IngestionDispatcher } from './dispatcher'
import type { SyncDb } from './sweeper'
import { createInlineDispatcher, createSyncDispatcher } from './dispatcher'
import { ingestNote } from './ingest'

/**
 * Manual "process now" for pending notes (plan-002-system §Sync service).
 * The sweeper only picks up notes settled for 5 minutes; this dispatches
 * pending notes immediately, scoped to one folder (exact match — the same
 * set of notes the Notes UI lists for that folder).
 *
 * Dispatcher resolution mirrors the sync service: Redis → BullMQ producer,
 * otherwise inline ingestion (tests). A test seam allows overriding the
 * dispatcher entirely so specs never touch Redis or AI providers.
 */
let testDispatcher: IngestionDispatcher | null = null

export function setProcessTestDispatcher(dispatcher: IngestionDispatcher | null): void {
  testDispatcher = dispatcher
}

export function resolveProcessDispatcher(env: { db: SyncDb, databaseUrl: string, redisUrl?: string }): IngestionDispatcher {
  if (testDispatcher)
    return testDispatcher

  const dispatcher = createSyncDispatcher({ db: env.db, redisUrl: env.redisUrl })
  if (dispatcher)
    return dispatcher

  return createInlineDispatcher({ db: env.db, run: noteId => ingestNote({ db: env.db, noteId }) })
}

export interface ProcessPendingResult {
  dispatched: number
  noteIds: string[]
}

export async function processPendingNotes(
  db: SyncDb,
  args: { workspaceId: string, syncedFolderId?: string | null, folderId: string | null, dispatcher: IngestionDispatcher },
): Promise<ProcessPendingResult> {
  let query = db
    .selectFrom('notes')
    .select('id')
    .where('workspace_id', '=', args.workspaceId)
    .where('status', '=', 'pending')

  if (args.syncedFolderId)
    query = query.where('synced_folder_id', '=', args.syncedFolderId)

  if (args.folderId === null)
    query = query.where('folder_id', 'is', null)
  else
    query = query.where('folder_id', '=', args.folderId)

  const pending = await query.execute()

  for (const note of pending)
    await args.dispatcher.dispatch(note.id)

  return { dispatched: pending.length, noteIds: pending.map(n => n.id) }
}
