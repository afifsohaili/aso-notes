import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

async function seedNotes(trx: any, workspaceId: string) {
  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: '/__default_synced_folder__' })
    .returning('id')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('folders')
    .values([
      { workspace_id: workspaceId, synced_folder_id: syncedFolder.id, path: '/project-a' },
      { workspace_id: workspaceId, synced_folder_id: syncedFolder.id, path: '/project-a/engineering' },
    ])
    .onConflict(oc => oc.columns(['synced_folder_id', 'path']).doNothing())
    .execute()

  const folderRows = await trx
    .selectFrom('folders')
    .select(['id', 'path'])
    .where('synced_folder_id', '=', syncedFolder.id)
    .execute()

  const folderByPath = new Map(folderRows.map(f => [f.path, f.id]))

  await trx
    .insertInto('notes')
    .values([
      {
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        path: '/project-a/plan.md',
        title: 'Plan',
        content: '# Plan',
        content_hash: 'h1',
        status: 'ingested',
        folder_id: folderByPath.get('/project-a'),
      },
      {
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        path: '/project-a/engineering/spec.md',
        title: 'Spec',
        content: '# Spec',
        content_hash: 'h2',
        status: 'ingested',
        folder_id: folderByPath.get('/project-a/engineering'),
      },
      {
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        path: '/inbox.md',
        title: 'Inbox',
        content: 'inbox',
        content_hash: 'h3',
        status: 'pending',
        folder_id: null,
      },
    ])
    .execute()

  return syncedFolder.id
}

describe('gET /api/notes/resolve', () => {
  test('returns 401 without a session', async ({ server }) => {
    const res = await server('/api/notes/resolve?path=project-a/plan.md')
    expect(res.status).toBe(401)
  })

  test('resolves a note path to type note with its folder and synced folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const syncedFolderId = await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/plan.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'note',
      path: '/project-a/plan.md',
      folder: '/project-a',
      syncedFolderId,
    })
  })

  test('resolves a root-level note with folder null', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const syncedFolderId = await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=inbox.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'note',
      path: '/inbox.md',
      folder: null,
      syncedFolderId,
    })
  })

  test('resolves a folder path to type folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const syncedFolderId = await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/engineering', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'folder',
      path: '/project-a/engineering',
      syncedFolderId,
    })
  })

  test('ignores a trailing slash when resolving a folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const syncedFolderId = await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'folder',
      path: '/project-a',
      syncedFolderId,
    })
  })

  test('returns 404 for an unknown path', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=unknown/missing.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(404)
  })

  test('rejects traversal attempts', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/../etc/passwd', { headers: { cookie: cookies } })
    expect(res.status).toBe(400)
  })

  test('rejects absolute paths', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=/etc/passwd', { headers: { cookie: cookies } })
    expect(res.status).toBe(400)
  })

  test('resolves the correct note when identical relative paths exist in two synced folders', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()

    const folderA = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspace.id, path: '/tmp/notes-a' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const folderB = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspace.id, path: '/tmp/notes-b' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('folders')
      .values([
        { workspace_id: workspace.id, synced_folder_id: folderA.id, path: '/ideas' },
        { workspace_id: workspace.id, synced_folder_id: folderB.id, path: '/ideas' },
      ])
      .execute()

    const [folderARow, folderBRow] = await trx
      .selectFrom('folders')
      .select(['id', 'synced_folder_id'])
      .where('workspace_id', '=', workspace.id)
      .where('path', '=', '/ideas')
      .execute()

    await trx
      .insertInto('notes')
      .values([
        {
          workspace_id: workspace.id,
          synced_folder_id: folderA.id,
          folder_id: folderARow.id,
          path: '/ideas/plan.md',
          title: 'Plan A',
          content_hash: 'h1',
          status: 'ingested',
        },
        {
          workspace_id: workspace.id,
          synced_folder_id: folderB.id,
          folder_id: folderBRow.id,
          path: '/ideas/plan.md',
          title: 'Plan B',
          content_hash: 'h2',
          status: 'ingested',
        },
      ])
      .execute()

    const resA = await server(`/api/notes/resolve?path=ideas/plan.md&syncedFolder=${folderA.id}`, { headers: { cookie: cookies } })
    expect(resA.status).toBe(200)
    expect(await resA.json()).toMatchObject({ type: 'note', path: '/ideas/plan.md', syncedFolderId: folderA.id })

    const resB = await server(`/api/notes/resolve?path=ideas/plan.md&syncedFolder=${folderB.id}`, { headers: { cookie: cookies } })
    expect(resB.status).toBe(200)
    expect(await resB.json()).toMatchObject({ type: 'note', path: '/ideas/plan.md', syncedFolderId: folderB.id })
  })
})
