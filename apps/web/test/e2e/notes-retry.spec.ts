import type { IngestionDispatcher } from '../../server/lib/sync/dispatcher'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, describe, expect } from 'vitest'
import { setProcessTestDispatcher } from '../../server/lib/sync/process'

function recordingDispatcher(): IngestionDispatcher & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    dispatch: async (noteId: string) => {
      calls.push(noteId)
    },
  }
}

async function seedNote(trx: any, workspaceId: string, notePath: string, status: string) {
  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: `/tmp/${crypto.randomUUID()}` })
    .returning('id')
    .executeTakeFirstOrThrow()

  const [folder] = await trx
    .insertInto('folders')
    .values({ workspace_id: workspaceId, synced_folder_id: syncedFolder.id, path: '/proj' })
    .returning('id')
    .execute()

  const [note] = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      synced_folder_id: syncedFolder.id,
      folder_id: folder.id,
      path: notePath,
      title: notePath,
      content: '# note',
      content_hash: `hash-${notePath}`,
      status,
      pipeline: 'markdown-note',
    })
    .returning('id')
    .execute()

  return note
}

describe('pOST /api/notes/retry', () => {
  afterEach(() => {
    setProcessTestDispatcher(null)
  })

  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/notes/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/proj/a.md' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns 404 for an unknown note path', async ({ server, trx: _trx }) => {
    const { cookies } = await givenVerifiedUser()
    setProcessTestDispatcher(recordingDispatcher())

    const res = await server('/api/notes/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ path: '/proj/ghost.md' }),
    })
    expect(res.status).toBe(404)
  })

  test('returns 400 when the note is not failed', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    setProcessTestDispatcher(recordingDispatcher())
    await seedNote(trx, workspace.id, '/proj/ok.md', 'ingested')

    const res = await server('/api/notes/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ path: '/proj/ok.md' }),
    })
    expect(res.status).toBe(400)
  })

  test('flips a failed note back to pending and dispatches it', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const dispatcher = recordingDispatcher()
    setProcessTestDispatcher(dispatcher)
    const note = await seedNote(trx, workspace.id, '/proj/broken.md', 'failed')

    const res = await server('/api/notes/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ path: '/proj/broken.md' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(dispatcher.calls).toEqual([note.id])

    const row = await trx
      .selectFrom('notes')
      .select('status')
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('pending')
  })
})
