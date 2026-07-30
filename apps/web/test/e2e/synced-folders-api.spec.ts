import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterAll, afterEach, describe, expect } from 'vitest'
import { syncedFolderEvents } from '../../server/lib/sync/synced-folders'

const tempDirs: string[] = []

function givenTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-synced-folders-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  syncedFolderEvents.removeAllListeners()
})

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

async function postFolder(server: any, cookies: string, folderPath: string): Promise<Response> {
  return server('/api/synced-folders', {
    method: 'POST',
    headers: { 'cookie': cookies, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  })
}

async function addFolder(server: any, trx: any, cookies: string, folderPath: string) {
  const res = await postFolder(server, cookies, folderPath)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.id).toBeTruthy()
  expect(body.path).toBe(path.resolve(folderPath))
  return body
}

describe('synced-folders API', () => {
  describe('gET /api/synced-folders', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/synced-folders')
      expect(res.status).toBe(401)
    })

    test('returns an empty list for a fresh workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await server('/api/synced-folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    })
  })

  describe('pOST /api/synced-folders', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await postFolder(server, '', '/tmp/fake')
      expect(res.status).toBe(401)
    })

    test('creates a synced folder for an existing directory and emits an in-process add event', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      mkdirSync(path.join(dir, 'nested'), { recursive: true })

      let emitted: unknown = null
      syncedFolderEvents.once('added', (event) => {
        emitted = event
      })

      const body = await addFolder(server, trx, cookies, dir)

      const row = await trx
        .selectFrom('synced_folders')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(row.workspace_id).toBe(workspace.id)
      expect(row.path).toBe(path.resolve(dir))

      expect(emitted).toMatchObject({
        workspaceId: workspace.id,
        syncedFolderId: body.id,
        path: path.resolve(dir),
      })
    })

    test('returns note counts in the list response', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, trx, cookies, dir)

      await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: body.id,
          path: '/x.md',
          title: 'x',
          content_hash: 'h',
          status: 'pending',
        })
        .execute()

      const res = await server('/api/synced-folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id: body.id, path: body.path, noteCount: 1 })
    })

    test('rejects a relative path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await postFolder(server, cookies, 'relative/path')
      expect(res.status).toBe(400)
    })

    test('rejects a non-existent path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await postFolder(server, cookies, '/tmp/definitely-does-not-exist-12345')
      expect(res.status).toBe(400)
    })

    test('rejects a file path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const file = path.join(dir, 'not-a-dir.txt')
      writeFileSync(file, 'x')
      const res = await postFolder(server, cookies, file)
      expect(res.status).toBe(400)
    })

    test('rejects a duplicate path', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      await addFolder(server, trx, cookies, dir)
      const res = await postFolder(server, cookies, dir)
      expect(res.status).toBe(409)
    })

    test('rejects a folder nested inside an existing synced folder', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const root = givenTempDir()
      const nested = path.join(root, 'nested')
      mkdirSync(nested, { recursive: true })
      await addFolder(server, trx, cookies, root)
      const res = await postFolder(server, cookies, nested)
      expect(res.status).toBe(409)
    })

    test('rejects a folder that contains an existing synced folder', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const root = givenTempDir()
      const nested = path.join(root, 'nested')
      mkdirSync(nested, { recursive: true })
      await addFolder(server, trx, cookies, nested)
      const res = await postFolder(server, cookies, root)
      expect(res.status).toBe(409)
    })
  })

  describe('dELETE /api/synced-folders/:id', () => {
    test('returns 401 when unauthenticated', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, trx, cookies, dir)

      const res = await server(`/api/synced-folders/${body.id}`, { method: 'DELETE' })
      expect(res.status).toBe(401)
    })

    test('deletes an empty synced folder and emits a remove event', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, trx, cookies, dir)

      let emitted: unknown = null
      syncedFolderEvents.once('removed', (event) => {
        emitted = event
      })

      const res = await server(`/api/synced-folders/${body.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)

      const row = await trx
        .selectFrom('synced_folders')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirst()
      expect(row).toBeUndefined()

      expect(emitted).toMatchObject({
        workspaceId: workspace.id,
        syncedFolderId: body.id,
      })
    })

    test('returns 409 when the synced folder has notes', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, trx, cookies, dir)

      await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: body.id,
          path: '/note.md',
          title: 'note',
          content_hash: 'h',
          status: 'pending',
        })
        .execute()

      const res = await server(`/api/synced-folders/${body.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(409)

      const row = await trx
        .selectFrom('synced_folders')
        .select('id')
        .where('id', '=', body.id)
        .executeTakeFirst()
      expect(row).toBeTruthy()
    })

    test('returns 404 for an unknown synced folder id', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await server(`/api/synced-folders/${crypto.randomUUID()}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(404)
    })
  })
})
