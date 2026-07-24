import type { SyncDb } from './sweeper'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'kysely'
import { contentHash } from './hash'
import { ancestorFolderPaths, FOLDER_COVER_FILENAME, folderPathOf, isFolderCoverPath, titleFromPath, toNotePath } from './paths'
import { decideUpsert } from './upsert-decision'

/**
 * Sync fast path (plan-002-system §Sync service): per-file upsert/delete of
 * notes rows driven by chokidar events or the startup scan. All functions
 * take a SyncDb so they run inside the test transaction or the production
 * pool.
 */

export interface FileEvent {
  db: SyncDb
  workspaceId: string
  notesDir: string
  absolutePath: string
}

export type UpsertOutcome = 'skip' | 'insert' | 'update' | 'rename'

/**
 * Ensure a folder row exists for every directory level of a note path
 * (path-string model, no parent_id; root notes get folder_id null — M1).
 * Returns the immediate parent folder id, or null for root-level notes.
 */
export async function ensureFolderRows(
  db: SyncDb,
  workspaceId: string,
  notePath: string,
): Promise<string | null> {
  const folders = ancestorFolderPaths(notePath)
  for (const folderPath of folders) {
    await db
      .insertInto('folders')
      .values({ workspace_id: workspaceId, path: folderPath })
      .onConflict(oc => oc.columns(['workspace_id', 'path']).doNothing())
      .execute()
  }
  const parentPath = folderPathOf(notePath)
  if (parentPath === '/')
    return null
  const parent = await db
    .selectFrom('folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', parentPath)
    .executeTakeFirstOrThrow()
  return parent.id
}

/**
 * Notes living under a folder path (by path prefix). The root folder '/'
 * contains every note in the workspace.
 */
function descendantNotesPredicate(db: SyncDb, workspaceId: string, folderPath: string) {
  return db
    .updateTable('notes')
    .set({ status: 'pending', updated_at: sql`now()` })
    .where('workspace_id', '=', workspaceId)
    .where('status', '<>', 'pending')
    .where('path', 'like', folderPath === '/' ? '/%' : `${folderPath}/%`)
}

/** Ensure a single folder row exists (used for covers, including the '/' root row). */
async function ensureFolderRow(db: SyncDb, workspaceId: string, folderPath: string): Promise<string> {
  await db
    .insertInto('folders')
    .values({ workspace_id: workspaceId, path: folderPath })
    .onConflict(oc => oc.columns(['workspace_id', 'path']).doNothing())
    .execute()
  const row = await db
    .selectFrom('folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', folderPath)
    .executeTakeFirstOrThrow()
  return row.id
}

/**
 * Folder-cover upsert (plan §Sync service: "__folder-cover.md files never
 * become Notes"). Stores content + hash on the folders row; a changed cover
 * cascades status='pending' to every descendant note so embeddings/extraction
 * pick up the new context. An unchanged cover is a no-op.
 */
async function handleCoverUpsert(
  db: SyncDb,
  workspaceId: string,
  notePath: string,
  content: string,
): Promise<UpsertOutcome> {
  const folderPath = folderPathOf(notePath)
  const hash = contentHash(content)
  await ensureFolderRow(db, workspaceId, folderPath)

  const folder = await db
    .selectFrom('folders')
    .select(['id', 'cover_hash'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', folderPath)
    .executeTakeFirstOrThrow()

  if (folder.cover_hash === hash)
    return 'skip'

  await db
    .updateTable('folders')
    .set({ cover_content: content, cover_hash: hash, updated_at: sql`now()` })
    .where('id', '=', folder.id)
    .execute()

  await descendantNotesPredicate(db, workspaceId, folderPath).execute()
  return 'update'
}

/** Folder-cover unlink: clear the cover and cascade re-ingestion. */
async function handleCoverUnlink(db: SyncDb, workspaceId: string, notePath: string): Promise<void> {
  const folderPath = folderPathOf(notePath)
  const folder = await db
    .selectFrom('folders')
    .select(['id', 'cover_hash'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', folderPath)
    .executeTakeFirst()
  if (!folder || folder.cover_hash === null)
    return
  await db
    .updateTable('folders')
    .set({ cover_content: null, cover_hash: null, updated_at: sql`now()` })
    .where('id', '=', folder.id)
    .execute()
  await descendantNotesPredicate(db, workspaceId, folderPath).execute()
}

/**
 * Handle a chokidar add/change: read the file, hash it, and apply the upsert
 * decision — skip unchanged content, update changed content (status pending),
 * move the row on rename (content hash found at a different path), or insert.
 * Folder covers are routed to the folders row instead.
 */
export async function handleFileUpsert(event: FileEvent): Promise<UpsertOutcome> {
  const { db, workspaceId, notesDir, absolutePath } = event
  const notePath = toNotePath(notesDir, absolutePath)
  const content = await readFile(absolutePath, 'utf8')

  if (isFolderCoverPath(notePath))
    return handleCoverUpsert(db, workspaceId, notePath, content)

  const hash = contentHash(content)

  const existingAtPath = await db
    .selectFrom('notes')
    .select(['id', 'content_hash', 'ingested_hash'])
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .executeTakeFirst()

  const existingWithHash = existingAtPath
    ? null
    : await db
        .selectFrom('notes')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('content_hash', '=', hash)
        .executeTakeFirst()

  const decision = decideUpsert({
    existingAtPath: existingAtPath ?? null,
    existingWithHash: existingWithHash ?? null,
    contentHash: hash,
  })

  switch (decision.kind) {
    case 'skip':
      return 'skip'
    case 'update': {
      const folderId = await ensureFolderRows(db, workspaceId, notePath)
      await db
        .updateTable('notes')
        .set({
          content,
          content_hash: hash,
          folder_id: folderId,
          status: 'pending',
          updated_at: sql`now()`,
        })
        .where('id', '=', decision.noteId)
        .execute()
      return 'update'
    }
    case 'rename': {
      // Move the row: preserve id, status, ingested_hash, links, and all
      // derived data — identical content needs no re-ingestion.
      const folderId = await ensureFolderRows(db, workspaceId, notePath)
      await db
        .updateTable('notes')
        .set({
          path: notePath,
          title: titleFromPath(notePath),
          content,
          folder_id: folderId,
          updated_at: sql`now()`,
        })
        .where('id', '=', decision.noteId)
        .execute()
      return 'rename'
    }
    case 'insert': {
      const folderId = await ensureFolderRows(db, workspaceId, notePath)
      await db
        .insertInto('notes')
        .values({
          workspace_id: workspaceId,
          folder_id: folderId,
          path: notePath,
          title: titleFromPath(notePath),
          content,
          content_hash: hash,
          status: 'pending',
        })
        .execute()
      return 'insert'
    }
  }
}

/**
 * Handle a chokidar unlink: delete the note row at the path. Chunks,
 * mentions, links, sources, and note_tags cascade via FK (M1). After a
 * rename the row has already moved to the new path, so the trailing unlink
 * for the old path is a no-op.
 */
export async function handleFileUnlink(event: FileEvent): Promise<void> {
  const { db, workspaceId, notesDir, absolutePath } = event
  const notePath = toNotePath(notesDir, absolutePath)
  if (isFolderCoverPath(notePath))
    return handleCoverUnlink(db, workspaceId, notePath)
  await db
    .deleteFrom('notes')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .execute()
}

/** Recursive *.md walk, skipping node_modules and dotfiles/dirs. */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return out // notes dir does not exist yet
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules')
      continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...await listMarkdownFiles(abs))
    else if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(abs)
  }
  return out
}

/**
 * Startup reconciliation (plan §Sync service: "startup scan fires add per
 * existing file → restart recovery"). Runs the same per-file upsert logic as
 * the watcher for every file on disk, deletes DB note rows whose files
 * vanished, and clears folder covers whose cover file vanished.
 */
export async function startupScan(args: {
  db: SyncDb
  workspaceId: string
  notesDir: string
}): Promise<void> {
  const { db, workspaceId, notesDir } = args

  const files = await listMarkdownFiles(notesDir)
  const notePaths = new Set<string>()
  for (const absolutePath of files) {
    await handleFileUpsert({ db, workspaceId, notesDir, absolutePath })
    notePaths.add(toNotePath(notesDir, absolutePath))
  }

  // DB rows missing from disk → delete (covers never became note rows, so
  // the notes table alone is the reconcile target).
  const dbNotes = await db
    .selectFrom('notes')
    .select('path')
    .where('workspace_id', '=', workspaceId)
    .execute()
  for (const row of dbNotes) {
    if (!notePaths.has(row.path)) {
      await db
        .deleteFrom('notes')
        .where('workspace_id', '=', workspaceId)
        .where('path', '=', row.path)
        .execute()
    }
  }

  // Folder covers whose file vanished while the app was down → clear.
  const coveredFolders = await db
    .selectFrom('folders')
    .select('path')
    .where('workspace_id', '=', workspaceId)
    .where('cover_hash', 'is not', null)
    .execute()
  for (const folder of coveredFolders) {
    const coverNotePath = folder.path === '/'
      ? `/${FOLDER_COVER_FILENAME}`
      : `${folder.path}/${FOLDER_COVER_FILENAME}`
    if (!notePaths.has(coverNotePath))
      await handleCoverUnlink(db, workspaceId, coverNotePath)
  }
}
