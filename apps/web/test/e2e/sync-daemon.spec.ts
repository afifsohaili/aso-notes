import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '@base/testing/test'
import { afterAll, describe, expect } from 'vitest'
import { createSyncDaemon } from '../../server/lib/sync/daemon'
import { emitSyncedFolderAdded } from '../../server/lib/sync/synced-folders'

/**
 * Sync daemon boot semantics (plan-007 bug found in browser verification):
 * at server boot on a fresh install no workspace exists yet, so the daemon
 * must stay alive and boot lazily when the first Synced Folder is added
 * (which only happens after signup provisions the workspace).
 */

const tempDirs: string[] = []

function givenTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-daemon-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenSyncedFolder(trx: any, workspaceId: string, folderPath: string): Promise<string> {
  const row = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: folderPath })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function noteAt(trx: any, syncedFolderId: string, notePath: string) {
  return trx
    .selectFrom('notes')
    .selectAll()
    .where('synced_folder_id', '=', syncedFolderId)
    .where('path', '=', notePath)
    .executeTakeFirst()
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw lastError
}

describe('sync daemon', () => {
  test('boots lazily when the first synced folder is added after a no-workspace boot', async ({ trx }) => {
    const daemon = createSyncDaemon({ db: trx, redisUrl: undefined })
    try {
      daemon.start()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(daemon.isBooted()).toBe(false)

      // signup provisions the workspace, then the wizard adds a synced folder
      const workspaceId = await givenWorkspace(trx, 'daemon-lazy-boot')
      const notesDir = givenTempDir()
      writeFileSync(path.join(notesDir, 'existing.md'), '# existing')
      const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)

      emitSyncedFolderAdded({ workspaceId, syncedFolderId, path: notesDir })

      await waitFor(() => expect(daemon.isBooted()).toBe(true))
      await waitFor(async () => {
        const note = await noteAt(trx, syncedFolderId, '/existing.md')
        expect(note).toBeTruthy()
        expect(note.status).toBe('pending')
      })
    }
    finally {
      await daemon.stop()
    }
  }, 15_000)

  test('starts syncing a new root when a folder is added after a normal boot', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'daemon-normal-boot')
    const firstDir = givenTempDir()
    await givenSyncedFolder(trx, workspaceId, firstDir)

    const daemon = createSyncDaemon({ db: trx, redisUrl: undefined })
    try {
      daemon.start()
      await waitFor(() => expect(daemon.isBooted()).toBe(true))

      const secondDir = givenTempDir()
      writeFileSync(path.join(secondDir, 'second.md'), '# second')
      const secondId = await givenSyncedFolder(trx, workspaceId, secondDir)
      emitSyncedFolderAdded({ workspaceId, syncedFolderId: secondId, path: secondDir })

      await waitFor(async () => {
        expect(await noteAt(trx, secondId, '/second.md')).toBeTruthy()
      })
    }
    finally {
      await daemon.stop()
    }
  }, 15_000)
})
