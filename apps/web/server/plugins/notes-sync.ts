import type { FSWatcher } from 'chokidar'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { createSyncDispatcher } from '../lib/sync/dispatcher'
import { handleFileUnlink, handleFileUpsert, startupScan } from '../lib/sync/files'
import { createFolderSync } from '../lib/sync/folder-sync'
import { ingestNote } from '../lib/sync/ingest'
import { runSweeperOnce, SWEEP_INTERVAL_MS } from '../lib/sync/sweeper'
import { emitSyncedFolderRemoved, syncedFolderEvents } from '../lib/sync/synced-folders'
import { resolveSyncWorkspace } from '../lib/sync/workspace'

/**
 * Notes sync daemon (plan-002-system §Sync service): chokidar-based folder
 * sync on one or more Synced Folders feeding the notes-table fast path, startup
 * scan after the initial chokidar pass, and the 30s sweeper dispatching settled
 * pending notes for ingestion.
 *
 * Redis is optional infrastructure: without NUXT_REDIS_URL there is no
 * dispatcher, the sweep is skipped (logged once), and notes simply sit at
 * status='pending'.
 */
export default defineNitroPlugin(() => {
  // skip initialising folder sync on pre-render
  if (import.meta.prerender)
    return

  // Test harnesses spawn the built server per file; folder sync and the
  // sweeper are covered by in-process e2e specs, so keep them out of those
  // processes.
  if (process.env.NUXT_DISABLE_NOTES_SYNC === '1')
    return

  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  // Boot is async (workspace resolution); event handlers log their own
  // errors so a boot failure never takes the server down.
  void (async () => {
    const workspaceId = await resolveSyncWorkspace(db)
    if (!workspaceId) {
      console.warn('notes-sync: no workspace found; sync disabled')
      return
    }

    const dispatcher = createSyncDispatcher({
      db,
      redisUrl: process.env.NUXT_REDIS_URL,
      inlineRun: noteId => ingestNote({ db, noteId }),
    })
    if (!dispatcher)
      console.warn('notes-sync: NUXT_REDIS_URL is not set; sweeper disabled — pending notes will not be ingested')

    const rootWatchers = new Map<string, FSWatcher>()

    function startRoot(folder: { id: string, path: string }): void {
      if (!existsSync(folder.path) || !statSync(folder.path).isDirectory()) {
        console.warn(`notes-sync: synced folder path does not exist or is not a directory, skipping: ${folder.path}`)
        return
      }

      const notesDir = path.resolve(folder.path)

      const fsWatcher = createFolderSync({
        notesDir,
        handlers: {
          onUpsert: absolutePath => handleFileUpsert({ db, workspaceId, syncedFolderId: folder.id, notesDir, absolutePath }),
          onUnlink: absolutePath => handleFileUnlink({ db, workspaceId, syncedFolderId: folder.id, notesDir, absolutePath }),
          onReady: () => startupScan({ db, workspaceId, syncedFolderId: folder.id, notesDir }),
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
        .catch((error: unknown) => console.error(`notes-sync: failed to close watcher for ${syncedFolderId}:`, error))
      rootWatchers.delete(syncedFolderId)
    }

    syncedFolderEvents.on('added', (event) => {
      if (event.workspaceId !== workspaceId)
        return
      startRoot({ id: event.syncedFolderId, path: event.path })
    })

    syncedFolderEvents.on('removed', (event) => {
      if (event.workspaceId !== workspaceId)
        return
      stopRoot(event.syncedFolderId)
    })

    // Emit removal events for any roots that are still running when the
    // plugin shuts down so chokidar handles are closed cleanly.
    const gracefulShutdown = () => {
      for (const syncedFolderId of rootWatchers.keys())
        emitSyncedFolderRemoved({ workspaceId, syncedFolderId })
    }
    process.on('SIGINT', gracefulShutdown)
    process.on('SIGTERM', gracefulShutdown)

    const syncedFolders = await db
      .selectFrom('synced_folders')
      .select(['id', 'path'])
      .where('workspace_id', '=', workspaceId)
      .execute()

    for (const folder of syncedFolders)
      startRoot(folder)

    if (dispatcher) {
      const timer = setInterval(() => {
        runSweeperOnce({ db, workspaceId, dispatcher })
          .catch(error => console.error('notes-sync: sweep failed:', error))
      }, SWEEP_INTERVAL_MS)
      timer.unref?.()
    }

    console.warn(`notes-sync: syncing ${syncedFolders.length} synced folder(s) for workspace ${workspaceId}`)
  })().catch(error => console.error('notes-sync: boot failed:', error))
})
