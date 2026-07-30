import type { FSWatcher } from 'chokidar'
import type { SyncDb } from './sweeper'
import type { SyncedFolderAdded, SyncedFolderRemoved } from './synced-folders'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createSyncDispatcher } from './dispatcher'
import { handleFileUnlink, handleFileUpsert, startupScan } from './files'
import { createFolderSync } from './folder-sync'
import { ingestNote } from './ingest'
import { runSweeperOnce, SWEEP_INTERVAL_MS } from './sweeper'
import { syncedFolderEvents } from './synced-folders'
import { resolveSyncWorkspace } from './workspace'

/**
 * Notes sync daemon (plan-002-system §Sync service, extracted from the
 * notes-sync nitro plugin so the boot semantics are testable): chokidar-based
 * folder sync on one or more Synced Folders feeding the notes-table fast
 * path, startup scan after the initial chokidar pass, and the 30s sweeper
 * dispatching settled pending notes for ingestion.
 *
 * Boot is LAZY: on a fresh install no workspace exists at server start, so
 * the daemon stays subscribed and boots when the first Synced Folder is
 * added (plan-007 onboarding flow). Redis is optional infrastructure:
 * without a redisUrl there is no dispatcher, the sweep is skipped, and notes
 * simply sit at status='pending'.
 */
export interface SyncDaemon {
  /** Subscribe to synced-folder events and attempt the initial boot. */
  start: () => void
  /** Unsubscribe, stop the sweeper, and close all folder-sync watchers. */
  stop: () => Promise<void>
  /** Whether a workspace has been resolved and roots are being synced. */
  isBooted: () => boolean
}

export function createSyncDaemon(args: {
  db: SyncDb
  redisUrl: string | undefined
  log?: (message: string) => void
}): SyncDaemon {
  const { db, redisUrl } = args
  const log = args.log ?? (message => console.warn(message))

  let workspaceId: string | null = null
  let booting: Promise<string | null> | null = null
  const rootWatchers = new Map<string, FSWatcher>()
  let sweepTimer: ReturnType<typeof setInterval> | null = null

  function startRoot(folder: { id: string, path: string }): void {
    if (!workspaceId || rootWatchers.has(folder.id))
      return
    if (!existsSync(folder.path) || !statSync(folder.path).isDirectory()) {
      log(`notes-sync: synced folder path does not exist or is not a directory, skipping: ${folder.path}`)
      return
    }

    const notesDir = path.resolve(folder.path)
    const fsWatcher = createFolderSync({
      notesDir,
      handlers: {
        onUpsert: absolutePath => handleFileUpsert({ db, workspaceId: workspaceId!, syncedFolderId: folder.id, notesDir, absolutePath }),
        onUnlink: absolutePath => handleFileUnlink({ db, workspaceId: workspaceId!, syncedFolderId: folder.id, notesDir, absolutePath }),
        onReady: () => startupScan({ db, workspaceId: workspaceId!, syncedFolderId: folder.id, notesDir }),
      },
    })

    rootWatchers.set(folder.id, fsWatcher)
  }

  function stopRoot(syncedFolderId: string): void {
    const watcher = rootWatchers.get(syncedFolderId)
    if (!watcher)
      return
    watcher
      .close()
      .catch((error: unknown) => console.error(`notes-sync: failed to close folder sync for ${syncedFolderId}:`, error))
    rootWatchers.delete(syncedFolderId)
  }

  async function boot(): Promise<string | null> {
    if (workspaceId)
      return workspaceId

    const resolved = await resolveSyncWorkspace(db)
    if (!resolved) {
      log('notes-sync: no workspace found; sync disabled until a synced folder is added')
      return null
    }
    workspaceId = resolved

    const dispatcher = createSyncDispatcher({
      db,
      redisUrl,
      inlineRun: noteId => ingestNote({ db, noteId }),
    })
    if (!dispatcher)
      log('notes-sync: NUXT_REDIS_URL is not set; sweeper disabled — pending notes will not be ingested')

    const syncedFolders = await db
      .selectFrom('synced_folders')
      .select(['id', 'path'])
      .where('workspace_id', '=', workspaceId)
      .execute()

    for (const folder of syncedFolders)
      startRoot(folder)

    if (dispatcher) {
      sweepTimer = setInterval(() => {
        runSweeperOnce({ db, workspaceId: workspaceId!, dispatcher })
          .catch(error => console.error('notes-sync: sweep failed:', error))
      }, SWEEP_INTERVAL_MS)
      sweepTimer.unref?.()
    }

    log(`notes-sync: syncing ${syncedFolders.length} synced folder(s) for workspace ${workspaceId}`)
    return workspaceId
  }

  function ensureBoot(): Promise<string | null> {
    if (!booting) {
      booting = boot().finally(() => {
        booting = null
      })
    }
    return booting
  }

  function onAdded(event: SyncedFolderAdded): void {
    ensureBoot()
      .then((bootedWorkspaceId) => {
        if (!bootedWorkspaceId || event.workspaceId !== bootedWorkspaceId)
          return
        startRoot({ id: event.syncedFolderId, path: event.path })
      })
      .catch(error => console.error('notes-sync: boot failed:', error))
  }

  function onRemoved(event: SyncedFolderRemoved): void {
    if (!workspaceId || event.workspaceId !== workspaceId)
      return
    stopRoot(event.syncedFolderId)
  }

  return {
    start() {
      syncedFolderEvents.on('added', onAdded)
      syncedFolderEvents.on('removed', onRemoved)
      ensureBoot().catch(error => console.error('notes-sync: boot failed:', error))
    },
    async stop() {
      syncedFolderEvents.off('added', onAdded)
      syncedFolderEvents.off('removed', onRemoved)
      if (sweepTimer)
        clearInterval(sweepTimer)
      for (const syncedFolderId of [...rootWatchers.keys()])
        stopRoot(syncedFolderId)
      // Allow in-flight watcher.close() promises to settle.
      await new Promise(resolve => setTimeout(resolve, 10))
    },
    isBooted: () => workspaceId !== null,
  }
}
