import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { createSyncDispatcher } from '../lib/sync/dispatcher'
import { handleFileUnlink, handleFileUpsert, startupScan } from '../lib/sync/files'
import { runSweeperOnce, SWEEP_INTERVAL_MS } from '../lib/sync/sweeper'
import { createNotesWatcher } from '../lib/sync/watcher'
import { resolveSyncWorkspace } from '../lib/sync/workspace'

/**
 * Notes sync daemon (plan-002-system §Sync service): chokidar watcher on the
 * notes dir feeding the notes-table fast path, startup scan after the
 * watcher's initial pass, and the 30s sweeper dispatching settled pending
 * notes for ingestion.
 *
 * Redis is optional infrastructure: without NUXT_REDIS_URL there is no
 * dispatcher, the sweep is skipped (logged once), and notes simply sit at
 * status='pending'.
 */
export default defineNitroPlugin(() => {
  // skip initialising the watcher on pre-render
  if (import.meta.prerender)
    return

  // Test harnesses spawn the built server per file; the watcher/sweeper are
  // covered by in-process e2e specs, so keep them out of those processes.
  if (process.env.NUXT_DISABLE_NOTES_SYNC === '1')
    return

  const config = useRuntimeConfig()
  const notesDir = path.resolve(config.notesDir || './notes')
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  // Boot is async (workspace resolution); event handlers log their own
  // errors so a boot failure never takes the server down.
  void (async () => {
    const workspaceId = await resolveSyncWorkspace(db)
    if (!workspaceId) {
      console.warn('notes-sync: no workspace found; sync disabled')
      return
    }

    mkdirSync(notesDir, { recursive: true })

    const dispatcher = createSyncDispatcher({ redisUrl: process.env.NUXT_REDIS_URL })
    if (!dispatcher)
      console.warn('notes-sync: NUXT_REDIS_URL is not set; sweeper disabled — pending notes will not be ingested')

    createNotesWatcher({
      notesDir,
      handlers: {
        onUpsert: absolutePath => handleFileUpsert({ db, workspaceId, notesDir, absolutePath }),
        onUnlink: absolutePath => handleFileUnlink({ db, workspaceId, notesDir, absolutePath }),
        onReady: () => startupScan({ db, workspaceId, notesDir }),
      },
    })

    if (dispatcher) {
      const timer = setInterval(() => {
        runSweeperOnce({ db, workspaceId, dispatcher })
          .catch(error => console.error('notes-sync: sweep failed:', error))
      }, SWEEP_INTERVAL_MS)
      timer.unref?.()
    }

    console.warn(`notes-sync: watching ${notesDir} (workspace ${workspaceId})`)
  })().catch(error => console.error('notes-sync: boot failed:', error))
})
