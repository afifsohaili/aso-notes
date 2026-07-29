import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { afterEach, describe, expect } from 'vitest'
import { StageRegistry } from '../../server/lib/pipeline/registry'
import { createInlineDispatcher } from '../../server/lib/sync/dispatcher'
import { ingestNote } from '../../server/lib/sync/ingest'
import { runSweeperOnce } from '../../server/lib/sync/sweeper'
import { getSweeperState, resetSweeperState } from '../../server/lib/sync/sweeper-state'

/**
 * M3 feature spec: the sweeper slow path + ingestion worker handler
 * (plan-002-system §Sync service). The dispatcher runs ingestion inline with
 * a stub StageRegistry — no Redis, no AI providers.
 */

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, updatedAt: string) {
  const row = await trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, path, title: path, content: '# body', content_hash: `hash-${path}` })
    .returning(['id', 'content_hash'])
    .executeTakeFirstOrThrow()
  await trx
    .updateTable('notes')
    .set({ updated_at: sql`now() - interval ${sql.lit(updatedAt)}` })
    .where('id', '=', row.id)
    .execute()
  return row
}

function markIngestedStage(): { id: string, invoke: (ctx: { db: any, note: { id: string, content_hash: string | null } }) => Promise<void> } {
  return {
    id: 'mark-ingested',
    async invoke(ctx) {
      await ctx.db
        .updateTable('notes')
        .set({ status: 'ingested', ingested_hash: ctx.note.content_hash, updated_at: sql`now()` })
        .where('id', '=', ctx.note.id)
        .execute()
    },
  }
}

function stubRegistry(stages: { id: string, invoke: (ctx: any) => Promise<void> }[]) {
  const registry = new StageRegistry()
  for (const stage of stages)
    registry.register(stage)
  return registry
}

async function getNote(trx: any, id: string) {
  return trx
    .selectFrom('notes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
}

describe('sweeper', () => {
  afterEach(() => {
    resetSweeperState()
  })

  test('dispatches ingestion only for pending notes settled past the settle interval', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-settle')
    const settled = await givenNote(trx, workspaceId, '/settled.md', '10 minutes')
    await givenNote(trx, workspaceId, '/fresh.md', '1 minute')

    const dispatched: string[] = []
    const result = await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({ db: trx, run: async (noteId) => { dispatched.push(noteId) } }),
    })

    expect(dispatched).toEqual([settled.id])
    expect(result.dispatched).toEqual([settled.id])
  })

  test('a successful pipeline run marks the note ingested with ingested_hash = content_hash', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-ingest')
    const note = await givenNote(trx, workspaceId, '/ok.md', '10 minutes')

    const registry = stubRegistry([markIngestedStage()])
    await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({
        db: trx,
        run: noteId => ingestNote({ db: trx, noteId, options: { registry, pipelines: { 'markdown-note': ['mark-ingested'] } } }),
      }),
    })

    const after = await getNote(trx, note.id)
    expect(after.status).toBe('ingested')
    expect(after.ingested_hash).toBe(note.content_hash)
  })

  test('a failing pipeline run marks the note failed and does not stop the sweep', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-fail')
    const bad = await givenNote(trx, workspaceId, '/bad.md', '10 minutes')
    const good = await givenNote(trx, workspaceId, '/good.md', '10 minutes')

    const okRegistry = stubRegistry([markIngestedStage()])
    const badRegistry = stubRegistry([{
      id: 'boom',
      invoke: async () => { throw new Error('stage exploded') },
    }])

    const result = await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({
        db: trx,
        run: noteId => ingestNote({
          db: trx,
          noteId,
          options: {
            registry: noteId === bad.id ? badRegistry : okRegistry,
            pipelines: { 'markdown-note': [noteId === bad.id ? 'boom' : 'mark-ingested'] },
          },
        }),
      }),
    })

    expect((await getNote(trx, bad.id)).status).toBe('failed')
    const goodAfter = await getNote(trx, good.id)
    expect(goodAfter.status).toBe('ingested')
    expect(goodAfter.ingested_hash).toBe(good.content_hash)
    expect(result.failed).toEqual([bad.id])
  })

  test('a note deleted between enqueue and ingestion is skipped without error', async ({ trx }) => {
    const registry = stubRegistry([{ id: 'noop', invoke: async () => {} }])
    await expect(ingestNote({
      db: trx,
      noteId: crypto.randomUUID(),
      options: { registry, pipelines: { 'markdown-note': ['noop'] } },
    })).resolves.toBeUndefined()
  })

  test('re-dispatches stale queued notes but leaves fresh queued notes alone', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-stale-queued')
    const stale = await givenNote(trx, workspaceId, '/stale-queued.md', '10 minutes')
    const fresh = await givenNote(trx, workspaceId, '/fresh-queued.md', '10 minutes')

    // Simulate a prior dispatch: both are queued, but only stale is old enough.
    await trx
      .updateTable('notes')
      .set({ status: 'queued' })
      .where('id', 'in', [stale.id, fresh.id])
      .execute()
    await trx
      .updateTable('notes')
      .set({ updated_at: sql`now() - interval '1 minute'` })
      .where('id', '=', fresh.id)
      .execute()

    const dispatched: string[] = []
    await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({ db: trx, run: async (noteId) => { dispatched.push(noteId) } }),
    })

    expect(dispatched).toEqual([stale.id])
  })

  test('does not re-dispatch processing notes', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-processing')
    await givenNote(trx, workspaceId, '/processing.md', '10 minutes')
    await trx.updateTable('notes').set({ status: 'processing' }).execute()

    const dispatched: string[] = []
    await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({ db: trx, run: async (noteId) => { dispatched.push(noteId) } }),
    })

    expect(dispatched).toHaveLength(0)
  })

  test('records a heartbeat with the last sweep result', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'sweep-heartbeat')
    const _a = await givenNote(trx, workspaceId, '/a.md', '10 minutes')
    const b = await givenNote(trx, workspaceId, '/b.md', '10 minutes')

    await runSweeperOnce({
      db: trx,
      workspaceId,
      dispatcher: createInlineDispatcher({
        db: trx,
        run: async (noteId) => {
          if (noteId === b.id)
            throw new Error('boom')
        },
      }),
    })

    const state = getSweeperState()
    expect(state.lastDispatched).toBe(1)
    expect(state.lastFailed).toBe(1)
    expect(state.lastSweepAt).not.toBeNull()
    expect(new Date(state.lastSweepAt!).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })
})
