import type { IngestionQueueSnapshot } from '../../server/lib/sync/queue'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { clearIngestionQueueOverride, setIngestionQueueOverride } from '../../server/lib/sync/queue'
import { resetSweeperState } from '../../server/lib/sync/sweeper-state'

describe('gET /api/ingestion/status', () => {
  test('returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/ingestion/status')
    expect(res.status).toBe(401)
  })

  test('returns flat status payload with db counts, queue counts, active jobs and sweeper heartbeat', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('notes')
      .values([
        { workspace_id: workspace.id, path: '/a.md', title: 'A', content: '', content_hash: 'a', status: 'pending' },
        { workspace_id: workspace.id, path: '/b.md', title: 'B', content: '', content_hash: 'b', status: 'queued' },
        { workspace_id: workspace.id, path: '/c.md', title: 'C', content: '', content_hash: 'c', status: 'processing' },
        { workspace_id: workspace.id, path: '/d.md', title: 'D', content: '', content_hash: 'd', status: 'ingested' },
        { workspace_id: workspace.id, path: '/e.md', title: 'E', content: '', content_hash: 'e', status: 'failed' },
      ])
      .execute()

    const activeNote = await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        path: '/active.md',
        title: 'Active Note',
        content: '',
        content_hash: 'active',
        status: 'processing',
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    const queue: IngestionQueueSnapshot = {
      getJobCounts: async () => ({
        waiting: 7,
        active: 1,
        completed: 2,
        failed: 3,
        delayed: 4,
      }),
      getActiveJobs: async () => ([{ id: activeNote.id, noteId: activeNote.id }]),
    }
    setIngestionQueueOverride(queue)

    resetSweeperState()
    const { recordSweeperHeartbeat } = await import('../../server/lib/sync/sweeper-state')
    recordSweeperHeartbeat({ dispatched: ['1', '2'], failed: ['3'] })

    try {
      const res = await server('/api/ingestion/status', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.db).toEqual({
        pending: 1,
        queued: 1,
        processing: 2,
        ingested: 1,
        failed: 1,
      })

      expect(body.queue).toEqual({
        waiting: 7,
        active: 1,
        completed: 2,
        failed: 3,
        delayed: 4,
      })

      expect(body.activeJobs).toEqual([{
        id: activeNote.id,
        path: '/active.md',
        title: 'Active Note',
      }])

      expect(body.sweeper).toMatchObject({
        lastDispatched: 2,
        lastFailed: 1,
      })
      expect(typeof body.sweeper.lastSweepAt).toBe('string')
    }
    finally {
      clearIngestionQueueOverride()
      resetSweeperState()
    }
  })

  test('returns queue: null and empty activeJobs when Redis is not configured', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        path: '/a.md',
        title: 'A',
        content: '',
        content_hash: 'a',
        status: 'pending',
      })
      .execute()

    clearIngestionQueueOverride()
    const originalRedis = process.env.NUXT_REDIS_URL
    delete process.env.NUXT_REDIS_URL

    try {
      const res = await server('/api/ingestion/status', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.queue).toBeNull()
      expect(body.activeJobs).toEqual([])
      expect(body.db).toEqual({ pending: 1, queued: 0, processing: 0, ingested: 0, failed: 0 })
    }
    finally {
      if (originalRedis)
        process.env.NUXT_REDIS_URL = originalRedis
    }
  })
})
