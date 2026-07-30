import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * In-process event seam so the folder CRUD endpoints can tell the running sync
 * plugin to start/stop syncing a root without polling or restarting the server.
 */

export interface SyncedFolderAdded {
  workspaceId: string
  syncedFolderId: string
  path: string
}

export interface SyncedFolderRemoved {
  workspaceId: string
  syncedFolderId: string
}

export const syncedFolderEvents = new EventEmitter()

export function emitSyncedFolderAdded(event: SyncedFolderAdded): void {
  syncedFolderEvents.emit('added', event)
}

export function emitSyncedFolderRemoved(event: SyncedFolderRemoved): void {
  syncedFolderEvents.emit('removed', event)
}

export class SyncedFolderValidationError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
    this.name = 'SyncedFolderValidationError'
  }
}

export interface ValidatedPath {
  normalized: string
}

/**
 * Validate a candidate Synced Folder path:
 *  - must be an absolute path string
 *  - must exist on disk and be a directory (no auto-creation)
 *  - must not already be registered for this workspace
 *  - must not be nested inside, or a parent of, an existing Synced Folder
 * Throws SyncedFolderValidationError with 400/409 status codes on failure.
 */
export function validateSyncedFolderPath(candidate: unknown, existingPaths: string[]): ValidatedPath {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new SyncedFolderValidationError(400, 'path is required and must be a string')
  }

  if (!path.isAbsolute(candidate)) {
    throw new SyncedFolderValidationError(400, 'path must be absolute')
  }

  const normalized = path.resolve(candidate)

  let stats
  try {
    stats = statSync(normalized)
  }
  catch {
    throw new SyncedFolderValidationError(400, 'path does not exist or is not accessible')
  }

  if (!stats.isDirectory()) {
    throw new SyncedFolderValidationError(400, 'path must be a directory')
  }

  for (const existingRaw of existingPaths) {
    const existing = path.resolve(existingRaw)
    if (normalized === existing) {
      throw new SyncedFolderValidationError(409, 'folder already registered')
    }
    if (normalized.startsWith(`${existing}${path.sep}`)) {
      throw new SyncedFolderValidationError(409, 'folder is nested inside an existing synced folder')
    }
    if (existing.startsWith(`${normalized}${path.sep}`)) {
      throw new SyncedFolderValidationError(409, 'folder contains an existing synced folder')
    }
  }

  return { normalized }
}
