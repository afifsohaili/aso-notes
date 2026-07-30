import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '@base/testing/test'
import { afterAll, describe, expect } from 'vitest'
import { handleFileUnlink, handleFileUpsert } from '../../server/lib/sync/files'
import { createFolderSync } from '../../server/lib/sync/folder-sync'
import { resolveSyncWorkspace } from '../../server/lib/sync/workspace'

/**
 * M3 smoke spec: real chokidar-based folder sync end-to-end against a temp
 * notes dir. Timing-sensitive behavior (settle sweeps, rename ordering) is
 * covered by driving handlers directly in notes-sync.spec.ts — here we only
 * prove chokidar events reach the sync handlers.
 *
 * Phase 2 update: handler calls now carry the synced_folder_id for the root.
 */

const tempDirs: string[] = []

function givenNotesDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-notes-sync-'))
  tempDirs.push(dir)
  return dir
}

async function givenSyncedFolder(trx: any, workspaceId: string, folderPath: string): Promise<string> {
  const row = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: folderPath })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
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

async function noteAt(trx: any, workspaceId: string, notePath: string) {
  return trx
    .selectFrom('notes')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .executeTakeFirst()
}

describe('folder sync (chokidar smoke)', () => {
  test('a written .md file is upserted and a deleted file removes the row', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-smoke')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)

    const folderSync = createFolderSync({
      notesDir,
      unlinkGraceMs: 10,
      handlers: {
        onUpsert: absolutePath => handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath }),
        onUnlink: absolutePath => handleFileUnlink({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath }),
      },
    })
    await new Promise<void>(resolve => folderSync.on('ready', () => resolve()))

    try {
      writeFileSync(path.join(notesDir, 'hello.md'), '# hello')
      await waitFor(async () => {
        const note = await noteAt(trx, workspaceId, '/hello.md')
        expect(note).toBeTruthy()
        expect(note.status).toBe('pending')
      })

      // non-markdown files are ignored
      writeFileSync(path.join(notesDir, 'data.json'), '{}')
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(await noteAt(trx, workspaceId, '/data.json')).toBeUndefined()

      unlinkSync(path.join(notesDir, 'hello.md'))
      await waitFor(async () => {
        expect(await noteAt(trx, workspaceId, '/hello.md')).toBeUndefined()
      })
    }
    finally {
      await folderSync.close()
    }
  }, 15_000)
})

describe('resolveSyncWorkspace', () => {
  test('resolves the first workspace (single-tenant MVP)', async ({ trx }) => {
    const first = await givenWorkspace(trx, 'sync-ws-first')
    await givenWorkspace(trx, 'sync-ws-second')

    const resolved = await resolveSyncWorkspace(trx)
    expect(resolved).toBeTruthy()
    // The earliest-created workspace in the DB wins; given these are the
    // only rows in this test's transaction-visible set, `first` is oldest.
    expect(resolved).toBe(first)
  })
})
