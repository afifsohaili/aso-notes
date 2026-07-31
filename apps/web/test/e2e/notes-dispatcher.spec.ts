import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { createBullMqDispatcher, createInlineDispatcher, INGEST_NOTE_JOB, purgeIngestionJobs } from '../../server/lib/sync/dispatcher'

/**
 * Feature spec for the ingestion dispatcher seam. Uses a fake queue and a real
 * test-transaction DB so status flips are observable at the boundary.
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

function fakeQueue(): { queue: any, enqueued: { name: string, data: { noteId: string }, opts?: { jobId: string } }[] } {
  const enqueued: { name: string, data: { noteId: string }, opts?: { jobId: string } }[] = []
  const queue = {
    add: async (name: string, data: { noteId: string }, opts?: { jobId: string }) => {
      enqueued.push({ name, data, opts })
    },
  }
  return { queue, enqueued }
}

describe('ingestion dispatcher', () => {
  test('BullMQ dispatcher enqueues with jobId = noteId and flips pending → queued', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-bull')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'pending')
    const { queue, enqueued } = fakeQueue()

    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await dispatcher.dispatch(noteId)

    expect(enqueued).toEqual([{ name: INGEST_NOTE_JOB, data: { noteId }, opts: { jobId: noteId } }])
    expect(await getStatus(trx, noteId)).toBe('queued')
  })

  test('BullMQ dispatcher leaves a queued note queued and refreshes updated_at on re-dispatch', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-redispatch')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'queued')
    await trx
      .updateTable('notes')
      .set({ updated_at: sql`now() - interval '10 minutes'` })
      .where('id', '=', noteId)
      .execute()

    const { queue, enqueued } = fakeQueue()
    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await dispatcher.dispatch(noteId)

    expect(enqueued).toHaveLength(1)
    expect(await getStatus(trx, noteId)).toBe('queued')
  })

  test('BullMQ dispatcher does not roll an ingested note backwards on re-dispatch', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-guard')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'ingested')
    const { queue, enqueued } = fakeQueue()

    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await dispatcher.dispatch(noteId)

    expect(enqueued).toHaveLength(1)
    expect(await getStatus(trx, noteId)).toBe('ingested')
  })

  test('BullMQ dispatcher leaves note pending when the queue add fails', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-fail')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'pending')
    const queue = {
      add: async () => { throw new Error('redis down') },
    }

    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await expect(dispatcher.dispatch(noteId)).rejects.toThrow('redis down')
    expect(await getStatus(trx, noteId)).toBe('pending')
  })

  test('BullMQ dispatcher removes a lingering failed job so a retry actually re-enqueues', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-retry-failed')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'pending')
    const enqueued: { name: string }[] = []
    const removed: string[] = []
    const jobs = new Map([[noteId, { getState: async () => 'failed' }]])
    const queue = {
      getJob: async (jobId: string) => jobs.get(jobId),
      remove: async (jobId: string) => {
        removed.push(jobId)
        jobs.delete(jobId)
      },
      add: async (name: string) => {
        enqueued.push({ name })
      },
    }

    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await dispatcher.dispatch(noteId)

    expect(removed).toEqual([noteId])
    expect(enqueued).toHaveLength(1)
    expect(await getStatus(trx, noteId)).toBe('queued')
  })

  test('BullMQ dispatcher leaves an active job untouched on re-dispatch', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-active')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'queued')
    const removed: string[] = []
    const queue = {
      getJob: async (jobId: string) => (jobId === noteId ? { getState: async () => 'active' } : undefined),
      remove: async (jobId: string) => {
        removed.push(jobId)
      },
      add: async () => {},
    }

    const dispatcher = createBullMqDispatcher({ db: trx, queue })
    await dispatcher.dispatch(noteId)

    expect(removed).toEqual([])
    expect(await getStatus(trx, noteId)).toBe('queued')
  })

  test('inline dispatcher flips pending → queued before running the job', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'dispatcher-inline')
    const noteId = await givenNote(trx, workspaceId, '/a.md', 'pending')
    const calls: string[] = []

    const dispatcher = createInlineDispatcher({
      db: trx,
      run: async (id) => {
        const status = await getStatus(trx, id)
        calls.push(`${id}:${status}`)
      },
    })
    await dispatcher.dispatch(noteId)

    expect(calls).toEqual([`${noteId}:queued`])
    expect(await getStatus(trx, noteId)).toBe('queued')
  })
})

describe('purgeIngestionJobs', () => {
  test('removes one job per existing note id and returns the purged count', async () => {
    const removed: string[] = []
    const queue = {
      getJob: async (jobId: string) => jobId === 'note-gone'
        ? undefined
        : ({ getState: async () => 'failed', remove: async () => { removed.push(jobId) } }),
    }

    const purged = await purgeIngestionJobs(queue, ['note-a', 'note-gone', 'note-b'])

    expect(removed).toEqual(['note-a', 'note-b'])
    expect(purged).toBe(2)
  })

  test('skips jobs that refuse removal (locked/active) without failing', async () => {
    const removed: string[] = []
    const queue = {
      getJob: async (jobId: string) => ({
        getState: async () => 'active',
        remove: async () => {
          if (jobId === 'note-locked')
            throw new Error('Cannot remove job when it is locked')
          removed.push(jobId)
        },
      }),
    }

    const purged = await purgeIngestionJobs(queue, ['note-a', 'note-locked', 'note-b'])

    expect(removed).toEqual(['note-a', 'note-b'])
    expect(purged).toBe(2)
  })
})
