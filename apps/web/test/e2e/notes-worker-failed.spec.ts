import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { handleFailedIngestionJob } from '../../server/lib/sync/worker-failed'

/**
 * Feature spec for the BullMQ failed-event handler extracted from the plugin.
 * The handler only flips rows that are still queued/processing, so it cannot
 * roll back a successful retry that finished around the same time.
 */

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, status: string) {
  const row = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content: '# note',
      content_hash: `hash-${path}`,
      status,
      pipeline: 'markdown-note',
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function getStatus(trx: any, noteId: string): Promise<string | null> {
  const row = await trx
    .selectFrom('notes')
    .select('status')
    .where('id', '=', noteId)
    .executeTakeFirst()
  return row?.status ?? null
}

describe('ingestion worker failed handler', () => {
  test('flips queued → failed', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'worker-failed-queued')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'queued')

    await handleFailedIngestionJob(trx, noteId)

    expect(await getStatus(trx, noteId)).toBe('failed')
  })

  test('flips processing → failed', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'worker-failed-processing')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'processing')

    await handleFailedIngestionJob(trx, noteId)

    expect(await getStatus(trx, noteId)).toBe('failed')
  })

  test('does not flip pending notes', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'worker-failed-pending')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'pending')

    await handleFailedIngestionJob(trx, noteId)

    expect(await getStatus(trx, noteId)).toBe('pending')
  })

  test('does not flip ingested notes backwards', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'worker-failed-ingested')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'ingested')

    await handleFailedIngestionJob(trx, noteId)

    expect(await getStatus(trx, noteId)).toBe('ingested')
  })

  test('does nothing for an unknown note id', async ({ trx }) => {
    await expect(handleFailedIngestionJob(trx, crypto.randomUUID())).resolves.toBeUndefined()
  })

  test('does nothing for undefined note id', async ({ trx }) => {
    await expect(handleFailedIngestionJob(trx, undefined)).resolves.toBeUndefined()
  })
})
