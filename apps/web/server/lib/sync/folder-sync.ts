import type { FSWatcher } from 'chokidar'
import path from 'node:path'
import { watch } from 'chokidar'

/**
 * Chokidar wiring for a Synced Folder (plan-002-system §Sync service). Kept
 * thin: events are translated into handler calls; all sync logic lives in
 * files.ts so tests can drive it without chokidar timing.
 */

/**
 * Grace window before an unlink deletes the note row. A rename shows up as
 * unlink(old) + add(new) in either order; delaying the delete lets the
 * rename guard (content-hash match on add) move the row first — the delayed
 * delete then finds nothing at the old path and no-ops.
 */
export const UNLINK_GRACE_MS = 1000

export interface FolderSyncHandlers {
  onUpsert: (absolutePath: string) => Promise<void> | void
  onUnlink: (absolutePath: string) => Promise<void> | void
  /** Fires once the initial chokidar scan completes (startup scan hook). */
  onReady?: () => Promise<void> | void
}

/** Sync **\/*.md under notesDir, ignoring node_modules and dotfiles. */
export function createFolderSync(args: {
  notesDir: string
  handlers: FolderSyncHandlers
  unlinkGraceMs?: number
}): FSWatcher {
  const { notesDir, handlers } = args
  const unlinkGraceMs = args.unlinkGraceMs ?? UNLINK_GRACE_MS

  const fsWatcher = watch(notesDir, {
    ignoreInitial: true,
    ignored: (candidate, stats) => {
      const base = path.basename(candidate)
      if (base.startsWith('.') || base === 'node_modules')
        return true
      // Directories must pass through so their .md children get synced;
      // only files (or extension-bearing paths) are filtered by suffix.
      if (stats ? stats.isFile() : path.extname(base) !== '')
        return !base.endsWith('.md')
      return false
    },
  })

  const safe = (fn: () => Promise<void> | void) => {
    Promise.resolve()
      .then(fn)
      .catch(error => console.error('notes-sync: handler error:', error))
  }

  fsWatcher.on('add', absolutePath => safe(() => handlers.onUpsert(absolutePath)))
  fsWatcher.on('change', absolutePath => safe(() => handlers.onUpsert(absolutePath)))

  const pendingUnlinks = new Map<string, NodeJS.Timeout>()
  fsWatcher.on('unlink', (absolutePath) => {
    clearTimeout(pendingUnlinks.get(absolutePath))
    pendingUnlinks.set(absolutePath, setTimeout(() => {
      pendingUnlinks.delete(absolutePath)
      safe(() => handlers.onUnlink(absolutePath))
    }, unlinkGraceMs))
  })

  fsWatcher.on('ready', () => safe(() => handlers.onReady?.()))

  return fsWatcher
}
