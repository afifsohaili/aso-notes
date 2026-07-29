import type { Database } from '@monorepo/shared'
import type { Kysely } from 'kysely'
import type { IngestionQueueSnapshot } from '../../server/lib/sync/queue'
import type { SweeperState } from '../../server/lib/sync/sweeper-state'
import { test } from '@base/testing/test'
import { describe, expect, vi } from 'vitest'
import { buildIngestionStatus } from '../../server/lib/sync/ingestion-status'

async function givenWorkspace(db: Kysely<Database>, name: string): Promise<string> {
  const row = await db
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(db: Kysely<Database>, workspaceId: string, path: string, status: string) {
  const row = await db
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

function fakeQueue(opts: {
  counts?: Partial<Awaited<ReturnType<IngestionQueueSnapshot['getJobCounts']>>>
  active?: { id: string, noteId: string }[]
} = {}): IngestionQueueSnapshot {
  return {
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      ...opts.counts,
    }),
    getActiveJobs: vi.fn().mockResolvedValue(opts.active ?? []),
  }
}

function fakeSweeper(partial: Partial<SweeperState> = {}): SweeperState {
  return {
    lastSweepAt: null,
    lastDispatched: 0,
    lastFailed: 0,
    ...partial,
  }
}

describe('buildIngestionStatus', () => {
  test('returns all db status counts and zeros for missing statuses', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-empty')
    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue: null,
      sweeperState: fakeSweeper(),
    })

    expect(result.db).toEqual({
      pending: 0,
      queued: 0,
      processing: 0,
      ingested: 0,
      failed: 0,
    })
  })

  test('counts notes by status within the workspace only', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-ws')
    const otherWorkspaceId = await givenWorkspace(trx, 'status-other')

    await givenNote(trx, workspaceId, '/a.md', 'pending')
    await givenNote(trx, workspaceId, '/b.md', 'queued')
    await givenNote(trx, workspaceId, '/c.md', 'processing')
    await givenNote(trx, workspaceId, '/d.md', 'ingested')
    await givenNote(trx, workspaceId, '/e.md', 'failed')
    await givenNote(trx, otherWorkspaceId, '/other.md', 'pending')

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue: null,
      sweeperState: fakeSweeper(),
    })

    expect(result.db).toEqual({
      pending: 1,
      queued: 1,
      processing: 1,
      ingested: 1,
      failed: 1,
    })
  })

  test('returns queue: null and empty activeJobs when no queue is provided', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-no-queue')
    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue: null,
      sweeperState: fakeSweeper(),
    })

    expect(result.queue).toBeNull()
    expect(result.activeJobs).toEqual([])
  })

  test('returns queue counts and maps active jobs to note paths in the workspace', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-queue')
    const noteId = await givenNote(trx, workspaceId, '/notes/active.md', 'processing')
    await givenNote(trx, workspaceId, '/notes/idle.md', 'pending')

    const queue = fakeQueue({
      counts: {
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 4,
        delayed: 5,
      },
      active: [{ id: noteId, noteId }],
    })

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue,
      sweeperState: fakeSweeper(),
    })

    expect(result.queue).toEqual({ waiting: 2, active: 1, completed: 3, failed: 4, delayed: 5 })
    expect(result.activeJobs).toEqual([{
      id: noteId,
      path: '/notes/active.md',
      title: '/notes/active.md',
    }])
  })

  test('skips active jobs whose note id is not in the workspace', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-filter')
    const otherWorkspaceId = await givenWorkspace(trx, 'status-filter-other')
    const localId = await givenNote(trx, workspaceId, '/local.md', 'processing')
    const otherId = await givenNote(trx, otherWorkspaceId, '/other.md', 'processing')

    const queue = fakeQueue({
      counts: { active: 2 },
      active: [
        { id: localId, noteId: localId },
        { id: otherId, noteId: otherId },
      ],
    })

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue,
      sweeperState: fakeSweeper(),
    })

    expect(result.activeJobs).toEqual([{ id: localId, path: '/local.md', title: '/local.md' }])
  })

  test('skips active jobs whose note id does not exist', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-missing')
    const queue = fakeQueue({
      counts: { active: 1 },
      active: [{ id: '00000000-0000-0000-0000-000000000000', noteId: '00000000-0000-0000-0000-000000000000' }],
    })

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue,
      sweeperState: fakeSweeper(),
    })

    expect(result.activeJobs).toEqual([])
  })

  test('resolves active jobs by noteId even when the BullMQ job id is numeric', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-numeric-jobid')
    const noteId = await givenNote(trx, workspaceId, '/notes/active.md', 'processing')

    const queue = fakeQueue({
      counts: { active: 2 },
      active: [
        { id: '8630', noteId },
        { id: '8631', noteId: '8631' },
      ],
    })

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue,
      sweeperState: fakeSweeper(),
    })

    expect(result.activeJobs).toEqual([{
      id: noteId,
      path: '/notes/active.md',
      title: '/notes/active.md',
    }])
  })

  test('returns the sweeper heartbeat unchanged', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'status-sweeper')
    const sweeper: SweeperState = {
      lastSweepAt: '2026-07-30T12:00:00.000Z',
      lastDispatched: 7,
      lastFailed: 2,
    }

    const result = await buildIngestionStatus({
      db: trx,
      workspaceId,
      queue: null,
      sweeperState: sweeper,
    })

    expect(result.sweeper).toEqual(sweeper)
  })
})
