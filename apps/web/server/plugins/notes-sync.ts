import process from 'node:process'
import { useDatabase } from '~~/utils/db'
import { createSyncDaemon } from '../lib/sync/daemon'

/**
 * Notes sync daemon plugin: thin wiring around createSyncDaemon (see
 * lib/sync/daemon.ts). Boot is lazy — on a fresh install the daemon boots
 * when the first Synced Folder is added via onboarding.
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

  const daemon = createSyncDaemon({
    db,
    redisUrl: process.env.NUXT_REDIS_URL,
  })
  daemon.start()

  const gracefulShutdown = () => {
    void daemon.stop()
  }
  process.on('SIGINT', gracefulShutdown)
  process.on('SIGTERM', gracefulShutdown)
})
