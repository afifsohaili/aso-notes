import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { afterAll, describe, expect } from 'vitest'
import { handleFileUnlink, handleFileUpsert, startupScan } from '../../server/lib/sync/files'

/**
 * M3 feature spec: the sync fast path (plan-002-system §Sync service).
 * Chokidar events are simulated by writing real files to a temp notes dir and
 * driving the internal handlers directly — chokidar timing stays out of the
 * assertions (one real chokidar smoke test lives in folder-sync.spec.ts).
 *
 * Phase 2 update: every handler call carries the synced_folder_id for the root
 * it is syncing.
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

function writeNote(notesDir: string, relPath: string, content: string): string {
  const abs = path.join(notesDir, relPath)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return abs
}

async function getNoteByPath(trx: any, workspaceId: string, notePath: string) {
  return trx
    .selectFrom('notes')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .executeTakeFirst()
}

async function folderPaths(trx: any, workspaceId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('folders')
    .select('path')
    .where('workspace_id', '=', workspaceId)
    .orderBy('path')
    .execute()
  return rows.map((r: any) => r.path)
}

describe('sync fast path: file add/change', () => {
  test('a new .md file becomes a pending note with a folder row per directory level', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-create')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'project-a/engineering/x.md', '# X\n')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const note = await getNoteByPath(trx, workspaceId, '/project-a/engineering/x.md')
    expect(note).toBeTruthy()
    expect(note.status).toBe('pending')
    expect(note.title).toBe('x')
    expect(note.content).toBe('# X\n')
    expect(note.content_hash).toBeTruthy()
    expect(note.synced_folder_id).toBe(syncedFolderId)

    const folders = await folderPaths(trx, workspaceId)
    expect(folders).toEqual(['/project-a', '/project-a/engineering'])

    // folder_id points at the immediate parent folder
    const parent = await trx
      .selectFrom('folders')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/project-a/engineering')
      .executeTakeFirstOrThrow()
    expect(note.folder_id).toBe(parent.id)
  })

  test('a root-level note has no folder row (M1: root notes have folder_id null)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-root')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'inbox.md', 'hi')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const note = await getNoteByPath(trx, workspaceId, '/inbox.md')
    expect(note.folder_id).toBeNull()
    expect(await folderPaths(trx, workspaceId)).toEqual([])
  })

  test('a synced note uses the markdown-note-with-links pipeline so wikilinks and sources are extracted at ingestion', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-pipeline')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'linked.md', '# Linked\n\nSee [[other]]. https://youtu.be/abc123\n')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const note = await getNoteByPath(trx, workspaceId, '/linked.md')
    expect(note.pipeline).toBe('markdown-note-with-links')
  })

  test('editing a legacy markdown-note row upgrades its pipeline to markdown-note-with-links', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-pipeline-upgrade')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'legacy.md', 'v1')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    // Simulate a note created before the pipeline was set at sync time.
    await trx
      .updateTable('notes')
      .set({ pipeline: 'markdown-note' })
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/legacy.md')
      .execute()

    writeFileSync(abs, 'v2 — changed')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const note = await getNoteByPath(trx, workspaceId, '/legacy.md')
    expect(note.pipeline).toBe('markdown-note-with-links')
  })

  test('modifying a file keeps the note id, bumps updated_at, and marks it pending', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-modify')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'a.md', 'v1')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    const before = await getNoteByPath(trx, workspaceId, '/a.md')
    // simulate the note having been ingested and then settling in the past
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: before.content_hash, updated_at: sql`now() - interval '1 hour'` })
      .where('id', '=', before.id)
      .execute()
    const backdated = (await getNoteByPath(trx, workspaceId, '/a.md')).updated_at

    writeFileSync(abs, 'v2 — changed')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const after = await getNoteByPath(trx, workspaceId, '/a.md')
    expect(after.id).toBe(before.id)
    expect(after.content).toBe('v2 — changed')
    expect(after.content_hash).not.toBe(before.content_hash)
    expect(after.status).toBe('pending')
    expect(after.updated_at.getTime()).toBeGreaterThan(backdated.getTime())
  })

  test('re-syncing unchanged content is a no-op (does not reset the settle clock)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-noop')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'a.md', 'same')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    const before = await getNoteByPath(trx, workspaceId, '/a.md')
    const settledAt = new Date(Date.now() - 10 * 60_000)
    await trx
      .updateTable('notes')
      .set({ updated_at: settledAt })
      .where('id', '=', before.id)
      .execute()

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    const after = await getNoteByPath(trx, workspaceId, '/a.md')
    expect(after.updated_at.getTime()).toBe(settledAt.getTime())
  })

  test('a file with the same content at a new path is a rename: same id, new path, status preserved', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-rename')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const oldAbs = writeNote(notesDir, 'old-name.md', 'rename me')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: oldAbs })
    const before = await getNoteByPath(trx, workspaceId, '/old-name.md')
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: before.content_hash })
      .where('id', '=', before.id)
      .execute()

    // chokidar fires `add` for the new path while the row still sits at the
    // old one (the unlink delete is grace-delayed) — the content hash match
    // must move the row instead of inserting a new note.
    const newAbs = writeNote(notesDir, 'archive/new-name.md', 'rename me')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: newAbs })

    expect(await getNoteByPath(trx, workspaceId, '/old-name.md')).toBeUndefined()
    const renamed = await getNoteByPath(trx, workspaceId, '/archive/new-name.md')
    expect(renamed.id).toBe(before.id)
    expect(renamed.status).toBe('ingested')
    expect(renamed.ingested_hash).toBe(before.content_hash)

    // folder rows exist for the new location
    expect(await folderPaths(trx, workspaceId)).toEqual(['/archive'])
    const parent = await trx
      .selectFrom('folders')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/archive')
      .executeTakeFirstOrThrow()
    expect(renamed.folder_id).toBe(parent.id)

    // the trailing unlink for the old path is then a no-op
    await handleFileUnlink({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: oldAbs })
    expect((await getNoteByPath(trx, workspaceId, '/archive/new-name.md')).id).toBe(before.id)
  })
})

describe('sync fast path: file unlink', () => {
  test('deleting a file deletes the note row', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-delete')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'gone.md', 'bye')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    expect(await getNoteByPath(trx, workspaceId, '/gone.md')).toBeTruthy()

    rmSync(abs, { force: true })
    await handleFileUnlink({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    expect(await getNoteByPath(trx, workspaceId, '/gone.md')).toBeUndefined()
  })

  test('an unlink for a file that exists again is a no-op (delete+recreate race, e.g. smoke-test rewrite)', async ({ trx }) => {
    // Browser-verification bug (Phase 7b): chokidar can deliver the upsert for
    // a recreated file BEFORE the grace-delayed unlink handler runs; a blind
    // delete then wipes the freshly recreated row and the note is stuck until
    // the next startup scan. The unlink handler must stat the path first.
    const workspaceId = await givenWorkspace(trx, 'sync-delete-recreate')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'recreated.md', '# v2')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    expect(await getNoteByPath(trx, workspaceId, '/recreated.md')).toBeTruthy()

    // delayed unlink fires while the file already exists again
    await handleFileUnlink({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })
    expect(await getNoteByPath(trx, workspaceId, '/recreated.md')).toBeTruthy()
  })
})

describe('folder covers', () => {
  test('a __folder-cover.md is never a Note — its content lands on the folders row', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-cover')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const abs = writeNote(notesDir, 'proj/__folder-cover.md', 'All about proj')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: abs })

    expect(await getNoteByPath(trx, workspaceId, '/proj/__folder-cover.md')).toBeUndefined()
    const folder = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/proj')
      .executeTakeFirstOrThrow()
    expect(folder.cover_content).toBe('All about proj')
    expect(folder.cover_hash).toBeTruthy()
  })

  test('a cover change marks all descendant notes pending (cascade re-ingestion)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-cover-cascade')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const coverAbs = writeNote(notesDir, 'proj/__folder-cover.md', 'v1 cover')
    const noteAbs = writeNote(notesDir, 'proj/sub/note.md', '# note')
    const outsideAbs = writeNote(notesDir, 'other/outside.md', '# outside')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: noteAbs })
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: outsideAbs })

    // both notes ingested
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: sql`content_hash` })
      .where('workspace_id', '=', workspaceId)
      .execute()

    writeFileSync(coverAbs, 'v2 cover — changed')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })

    const descendant = await getNoteByPath(trx, workspaceId, '/proj/sub/note.md')
    expect(descendant.status).toBe('pending')
    const outside = await getNoteByPath(trx, workspaceId, '/other/outside.md')
    expect(outside.status).toBe('ingested')

    const folder = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/proj')
      .executeTakeFirstOrThrow()
    expect(folder.cover_content).toBe('v2 cover — changed')
  })

  test('an unchanged cover is a no-op (no cascade)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-cover-noop')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const coverAbs = writeNote(notesDir, 'proj/__folder-cover.md', 'same cover')
    const noteAbs = writeNote(notesDir, 'proj/note.md', '# note')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: noteAbs })
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: sql`content_hash` })
      .where('workspace_id', '=', workspaceId)
      .execute()

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })

    const note = await getNoteByPath(trx, workspaceId, '/proj/note.md')
    expect(note.status).toBe('ingested')
  })

  test('a root-level cover lives on the "/" folder row and cascades to every note', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-cover-root')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const coverAbs = writeNote(notesDir, '__folder-cover.md', 'root cover')
    const noteAbs = writeNote(notesDir, 'proj/note.md', '# note')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: noteAbs })
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: sql`content_hash` })
      .where('workspace_id', '=', workspaceId)
      .execute()

    writeFileSync(coverAbs, 'root cover v2')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })

    const root = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/')
      .executeTakeFirstOrThrow()
    expect(root.cover_content).toBe('root cover v2')
    expect((await getNoteByPath(trx, workspaceId, '/proj/note.md')).status).toBe('pending')
  })

  test('deleting a cover clears it from the folder row and cascades', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sync-cover-unlink')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)
    const coverAbs = writeNote(notesDir, 'proj/__folder-cover.md', 'cover')
    const noteAbs = writeNote(notesDir, 'proj/note.md', '# note')

    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: noteAbs })
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: sql`content_hash` })
      .where('workspace_id', '=', workspaceId)
      .execute()

    rmSync(coverAbs, { force: true })
    await handleFileUnlink({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: coverAbs })

    const folder = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/proj')
      .executeTakeFirstOrThrow()
    expect(folder.cover_content).toBeNull()
    expect(folder.cover_hash).toBeNull()
    expect((await getNoteByPath(trx, workspaceId, '/proj/note.md')).status).toBe('pending')
  })
})

describe('startup scan', () => {
  test('reconciles disk vs DB: new files pending, vanished rows deleted, unchanged ingested notes untouched', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'scan-reconcile')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)

    // pre-existing DB state: an ingested note that still exists on disk, and
    // a note whose file was deleted while the app was down
    const keepAbs = writeNote(notesDir, 'keep.md', 'still here')
    await handleFileUpsert({ db: trx, workspaceId, syncedFolderId, notesDir, absolutePath: keepAbs })
    const keep = await getNoteByPath(trx, workspaceId, '/keep.md')
    await trx
      .updateTable('notes')
      .set({ status: 'ingested', ingested_hash: keep.content_hash })
      .where('id', '=', keep.id)
      .execute()
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspaceId,
        synced_folder_id: syncedFolderId,
        path: '/vanished.md',
        title: 'vanished',
        content: 'gone',
        content_hash: 'h',
      })
      .execute()

    // new file created while the app was down
    writeNote(notesDir, 'fresh/new.md', '# new')

    await startupScan({ db: trx, workspaceId, syncedFolderId, notesDir })

    // disk file missing from DB → pending note
    const added = await getNoteByPath(trx, workspaceId, '/fresh/new.md')
    expect(added).toBeTruthy()
    expect(added.status).toBe('pending')

    // DB row missing from disk → deleted
    expect(await getNoteByPath(trx, workspaceId, '/vanished.md')).toBeUndefined()

    // unchanged ingested note → same id, still ingested (skip rule)
    const keepAfter = await getNoteByPath(trx, workspaceId, '/keep.md')
    expect(keepAfter.id).toBe(keep.id)
    expect(keepAfter.status).toBe('ingested')
  })

  test('reconciles covers: stores on-disk covers and clears covers whose file vanished', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'scan-covers')
    const notesDir = givenNotesDir()
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, notesDir)

    writeNote(notesDir, 'proj/__folder-cover.md', 'proj cover')
    await trx
      .insertInto('folders')
      .values({ workspace_id: workspaceId, synced_folder_id: syncedFolderId, path: '/stale', cover_content: 'old', cover_hash: 'h' })
      .execute()

    await startupScan({ db: trx, workspaceId, syncedFolderId, notesDir })

    const proj = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/proj')
      .executeTakeFirstOrThrow()
    expect(proj.cover_content).toBe('proj cover')

    const stale = await trx
      .selectFrom('folders')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('path', '=', '/stale')
      .executeTakeFirstOrThrow()
    expect(stale.cover_content).toBeNull()
    expect(stale.cover_hash).toBeNull()
  })
})
