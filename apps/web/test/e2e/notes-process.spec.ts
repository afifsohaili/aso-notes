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

async function seedFolderWithNotes(
  trx: any,
  workspaceId: string,
  folderPath: string,
  notes: { path: string, status?: string, pipeline?: string }[],
) {
  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: `/tmp/${crypto.randomUUID()}` })
    .returning('id')
    .executeTakeFirstOrThrow()

  const [folder] = await trx
    .insertInto('folders')
    .values({ workspace_id: workspaceId, synced_folder_id: syncedFolder.id, path: folderPath })
    .returning('id')
    .execute()

  for (const note of notes) {
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        folder_id: folder.id,
        path: note.path,
        title: note.path,
        content: '# note',
        content_hash: `hash-${note.path}`,
        status: note.status ?? 'pending',
        pipeline: note.pipeline ?? 'markdown-note',
      })
      .execute()
  }

  return folder
}

describe('pOST /api/notes/process', () => {
  afterEach(() => {
    setProcessTestDispatcher(null)
  })

  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/notes/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: '/proj' }),
    })
    expect(res.status).toBe(401)
  })

  test('dispatches only pending notes in the given folder', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const dispatcher = recordingDispatcher()
    setProcessTestDispatcher(dispatcher)

    await seedFolderWithNotes(trx, workspace.id, '/proj', [
      { path: '/proj/a.md' },
      { path: '/proj/b.md' },
      { path: '/proj/c.md', status: 'ingested' },
    ])
    await seedFolderWithNotes(trx, workspace.id, '/other', [
      { path: '/other/d.md' },
    ])

    const res = await server('/api/notes/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ folder: '/proj' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dispatched).toBe(2)
    expect(dispatcher.calls).toHaveLength(2)
  })

  test('returns 404 for an unknown folder', async ({ server, trx: _trx }) => {
    const { cookies } = await givenVerifiedUser()
    setProcessTestDispatcher(recordingDispatcher())

    const res = await server('/api/notes/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ folder: '/nope' }),
    })

    expect(res.status).toBe(404)
  })
})
