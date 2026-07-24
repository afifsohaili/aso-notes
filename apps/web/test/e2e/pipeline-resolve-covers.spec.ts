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
  path: string,
  coverContent: string | null,
): Promise<string> {
  const row = await trx
    .insertInto('folders')
    .values({ workspace_id: workspaceId, path, cover_content: coverContent })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(
  trx: any,
  workspaceId: string,
  path: string,
  folderId: string | null,
): Promise<{ id: string, path: string, folder_id: string | null }> {
  const row = await trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, path, title: path, folder_id: folderId, content: '# note' })
    .returning(['id', 'path', 'folder_id'])
    .executeTakeFirstOrThrow()
  return row
}

function ctxFor(trx: any, workspaceId: string, note: any): PipelineContext {
  return new PipelineContext({
    note: {
      id: note.id,
      workspace_id: workspaceId,
      folder_id: note.folder_id,
      path: note.path,
      title: note.path,
      content: '# note',
      pipeline: 'markdown-note',
    },
    workspaceId,
    db: trx,
  })
}

describe('resolve-covers stage', () => {
  test('merges ancestor covers root→leaf, skipping folders without covers', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-basic')
    await givenFolder(trx, workspaceId, '/', 'root cover')
    await givenFolder(trx, workspaceId, '/proj', null) // no cover — skipped
    const subId = await givenFolder(trx, workspaceId, '/proj/sub', 'sub cover')
    const note = await givenNote(trx, workspaceId, '/proj/sub/note.md', subId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('root cover\n\nsub cover')
  })

  test(`caps the chain at ${MAX_COVER_CHAIN_DEPTH} levels (nearest ancestors win)`, async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-deep')
    await givenFolder(trx, workspaceId, '/', 'cover-root')
    await givenFolder(trx, workspaceId, '/a', 'cover-a')
    await givenFolder(trx, workspaceId, '/a/b', 'cover-b')
    await givenFolder(trx, workspaceId, '/a/b/c', 'cover-c')
    const deepId = await givenFolder(trx, workspaceId, '/a/b/c/d', 'cover-d')
    const note = await givenNote(trx, workspaceId, '/a/b/c/d/note.md', deepId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    // 5 covers exist but the cap keeps the nearest 4 levels: /a down to /a/b/c/d
    expect(ctx.coverChain).toBe('cover-a\n\ncover-b\n\ncover-c\n\ncover-d')
    expect(ctx.coverChain).not.toContain('cover-root')
  })

  test('falls back to the note path when folder_id is null (root note)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-root-note')
    await givenFolder(trx, workspaceId, '/', 'root cover')
    const note = await givenNote(trx, workspaceId, '/loose.md', null)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('root cover')
  })

  test('leaves coverChain unset when no ancestor has a cover', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'covers-none')
    const folderId = await givenFolder(trx, workspaceId, '/empty', null)
    const note = await givenNote(trx, workspaceId, '/empty/note.md', folderId)

    const ctx = ctxFor(trx, workspaceId, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBeUndefined()
  })

  test('covers from another workspace are never merged', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'covers-tenant-a')
    const wsB = await givenWorkspace(trx, 'covers-tenant-b')
    await givenFolder(trx, wsA, '/', 'ws-a root cover')
    await givenFolder(trx, wsB, '/', 'ws-b root cover')
    const note = await givenNote(trx, wsA, '/loose.md', null)

    const ctx = ctxFor(trx, wsA, note)
    await new ResolveCoversStage().invoke(ctx)

    expect(ctx.coverChain).toBe('ws-a root cover')
  })
})
