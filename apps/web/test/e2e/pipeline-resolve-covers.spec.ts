import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { MAX_COVER_CHAIN_DEPTH, ResolveCoversStage } from '../../server/lib/pipeline/stages/resolve-covers'

/**
 * M2 feature spec for the resolve-covers stage: nearest-ancestor folder-cover
 * merge, root→leaf order, 4-level cap (plan-002-system §Ingestion pipeline).
 */

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenFolder(
  trx: any,
  workspaceId: string,
  syncedFolderId: string,
  path: string,
  coverContent: string | null,
): Promise<string> {
  const row = await trx
    .insertInto('folders')
    .values({ workspace_id: workspaceId, synced_folder_id: syncedFolderId, path, cover_content: coverContent })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(
  trx: any,
  workspaceId: string,
  syncedFolderId: string,
  path: string,
  folderId: string | null,
): Promise<{ id: string, path: string, folder_id: string | null, synced_folder_id: string }> {
  const row = await trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, synced_folder_id: syncedFolderId, path, title: path, folder_id: folderId, content: '# note' })
    .returning(['id', 'path', 'folder_id', 'synced_folder_id'])
    .executeTakeFirstOrThrow()
  return row
}

async function givenSyncedFolder(trx: any, workspaceId: string, path: string): Promise<string> {
  const row = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

function ctxFor(trx: any, workspaceId: string, note: any): PipelineContext {
  return new PipelineContext({
    note: {
      id: note.id,
      workspace_id: workspaceId,
      synced_folder_id: note.synced_folder_id,
      folder_id: note.folder_id,
      path: note.path,
      title: note.path,
      content: '# note',
      content_hash: null,
      pipeline: 'markdown-note',
    },
    workspaceId,
    db: trx,
  })
}

describe('resolve-covers stage', () => {
  test('merges ancestor covers root→leaf, skipping folders without covers', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-basic')
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, '/tmp/covers-basic')
    await givenFolder(trx, workspaceId, syncedFolderId, '/', 'root cover')
    await givenFolder(trx, workspaceId, syncedFolderId, '/proj', null) // no cover — skipped
    const subId = await givenFolder(trx, workspaceId, syncedFolderId, '/proj/sub', 'sub cover')
    const note = await givenNote(trx, workspaceId, syncedFolderId, '/proj/sub/note.md', subId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('root cover\n\nsub cover')
  })

  test(`caps the chain at ${MAX_COVER_CHAIN_DEPTH} levels (nearest ancestors win)`, async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-deep')
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, '/tmp/covers-deep')
    await givenFolder(trx, workspaceId, syncedFolderId, '/', 'cover-root')
    await givenFolder(trx, workspaceId, syncedFolderId, '/a', 'cover-a')
    await givenFolder(trx, workspaceId, syncedFolderId, '/a/b', 'cover-b')
    await givenFolder(trx, workspaceId, syncedFolderId, '/a/b/c', 'cover-c')
    const deepId = await givenFolder(trx, workspaceId, syncedFolderId, '/a/b/c/d', 'cover-d')
    const note = await givenNote(trx, workspaceId, syncedFolderId, '/a/b/c/d/note.md', deepId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    // 5 covers exist but the cap keeps the nearest 4 levels: /a down to /a/b/c/d
    expect(ctx.coverChain).toBe('cover-a\n\ncover-b\n\ncover-c\n\ncover-d')
    expect(ctx.coverChain).not.toContain('cover-root')
  })

  test('falls back to the note path when folder_id is null (root note)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-root-note')
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, '/tmp/covers-root-note')
    await givenFolder(trx, workspaceId, syncedFolderId, '/', 'root cover')
    const note = await givenNote(trx, workspaceId, syncedFolderId, '/loose.md', null)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('root cover')
  })

  test('leaves coverChain unset when no ancestor has a cover', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-none')
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, '/tmp/covers-none')
    const folderId = await givenFolder(trx, workspaceId, syncedFolderId, '/empty', null)
    const note = await givenNote(trx, workspaceId, syncedFolderId, '/empty/note.md', folderId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBeUndefined()
  })

  test('covers from another workspace are never merged', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'covers-tenant-a')
    const wsB = await givenWorkspace(trx, 'covers-tenant-b')
    const sfA = await givenSyncedFolder(trx, wsA, '/tmp/covers-a')
    const sfB = await givenSyncedFolder(trx, wsB, '/tmp/covers-b')
    await givenFolder(trx, wsA, sfA, '/', 'ws-a root cover')
    await givenFolder(trx, wsB, sfB, '/', 'ws-b root cover')
    const note = await givenNote(trx, wsA, sfA, '/loose.md', null)

    const ctx = ctxFor(trx, wsA, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('ws-a root cover')
  })
})
