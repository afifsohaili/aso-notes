import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

async function seedNotes(trx: any, workspaceId: string) {
  await trx
    .insertInto('folders')
    .values([
      { workspace_id: workspaceId, path: '/project-a' },
      { workspace_id: workspaceId, path: '/project-a/engineering' },
    ])
    .onConflict(oc => oc.columns(['workspace_id', 'path']).doNothing())
    .execute()

  const folderRows = await trx
    .selectFrom('folders')
    .select(['id', 'path'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const folderByPath = new Map(folderRows.map(f => [f.path, f.id]))

  await trx
    .insertInto('notes')
    .values([
      {
        workspace_id: workspaceId,
        path: '/project-a/plan.md',
        title: 'Plan',
        content: '# Plan',
        content_hash: 'h1',
        status: 'ingested',
        folder_id: folderByPath.get('/project-a'),
      },
      {
        workspace_id: workspaceId,
        path: '/project-a/engineering/spec.md',
        title: 'Spec',
        content: '# Spec',
        content_hash: 'h2',
        status: 'ingested',
        folder_id: folderByPath.get('/project-a/engineering'),
      },
      {
        workspace_id: workspaceId,
        path: '/inbox.md',
        title: 'Inbox',
        content: 'inbox',
        content_hash: 'h3',
        status: 'pending',
        folder_id: null,
      },
    ])
    .execute()
}

describe('gET /api/notes/resolve', () => {
  test('returns 401 without a session', async ({ server }) => {
    const res = await server('/api/notes/resolve?path=project-a/plan.md')
    expect(res.status).toBe(401)
  })

  test('resolves a note path to type note with its folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/plan.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'note',
      path: '/project-a/plan.md',
      folder: '/project-a',
    })
  })

  test('resolves a root-level note with folder null', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=inbox.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'note',
      path: '/inbox.md',
      folder: null,
    })
  })

  test('resolves a folder path to type folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/engineering', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'folder',
      path: '/project-a/engineering',
    })
  })

  test('ignores a trailing slash when resolving a folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await seedNotes(trx, workspace.id)

    const res = await server('/api/notes/resolve?path=project-a/', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      type: 'folder',
      path: '/project-a',
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
})
