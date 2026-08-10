import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { ensureNotesGraphCatalog } from './age-catalog'

async function seedNotesDomain(trx: any, workspaceId: string) {
  await ensureNotesGraphCatalog(trx)

  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path: '/__default_synced_folder__' })
    .returning('id')
    .executeTakeFirstOrThrow()

  const folder = await trx
    .insertInto('folders')
    .values({ workspace_id: workspaceId, synced_folder_id: syncedFolder.id, path: '/project-a' })
    .returning('id')
    .executeTakeFirstOrThrow()

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      synced_folder_id: syncedFolder.id,
      folder_id: folder.id,
      path: '/project-a/plan.md',
      title: 'Plan',
      content: '# Plan',
      content_hash: 'hash',
      status: 'ingested',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  return { note, syncedFolder }
}

async function givenTrace(trx: any, workspaceId: string, traceId: string, ownerId: string) {
  await trx
    .insertInto('llm_traces')
    .values({
      id: traceId,
      workspace_id: workspaceId,
      kind: 'ingestion',
      owner_type: 'notes',
      owner_id: ownerId,
      status: 'completed',
    })
    .execute()
}

async function givenExtractionGeneration(trx: any, workspaceId: string, traceId: string) {
  return trx
    .insertInto('llm_generations')
    .values({
      workspace_id: workspaceId,
      trace_id: traceId,
      seq: 0,
      llm_use_case: 'extraction',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      prompt: JSON.stringify([{ role: 'system', content: 'from trace' }, { role: 'user', content: 'note body' }]),
      response: JSON.stringify({ role: 'assistant', content: '{"concepts":[]}' }),
      prompt_tokens: 100,
      completion_tokens: 50,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
}

function makePointerLastRun(traceId: string) {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'succeeded',
    failed_stage: null,
    error: null,
    attempt: 1,
    job_id: null,
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.123Z',
    duration_ms: 5123,
    chunks: 1,
    extraction: {
      strategy: 'full',
      model: 'openai/gpt-4o-mini',
      trace_id: traceId,
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      counts: { concepts: 1, relations: 0, mentions: 0, tags: 0 },
    },
  }
}

function makeLegacyLastRun() {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'succeeded',
    failed_stage: null,
    error: null,
    attempt: 1,
    job_id: null,
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.123Z',
    duration_ms: 5123,
    chunks: 1,
    extraction: {
      strategy: 'full',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: 'inline' }, { role: 'user', content: 'legacy' }],
      response: '{"concepts":[]}',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      counts: { concepts: 1, relations: 0, mentions: 0, tags: 0 },
    },
  }
}

describe('llm tracing: last_run readers', () => {
  test('note detail hydrates extraction messages/response from the linked trace', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { note } = await seedNotesDomain(trx, workspace.id)
    const traceId = '11111111-1111-1111-1111-111111111111'
    await givenTrace(trx, workspace.id, traceId, note.id)
    await givenExtractionGeneration(trx, workspace.id, traceId)

    await trx
      .updateTable('notes')
      .set({ last_run: JSON.stringify(makePointerLastRun(traceId)) as any })
      .where('id', '=', note.id)
      .execute()

    const res = await server('/api/notes/project-a/plan.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.lastRun.extraction.messages).toEqual([
      { role: 'system', content: 'from trace' },
      { role: 'user', content: 'note body' },
    ])
    expect(body.lastRun.extraction.response).toBe('{"concepts":[]}')
  })

  test('note list summary strips trace_id and never exposes messages/response', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { note } = await seedNotesDomain(trx, workspace.id)
    const traceId = '11111111-1111-1111-1111-111111111111'
    await givenTrace(trx, workspace.id, traceId, note.id)
    await givenExtractionGeneration(trx, workspace.id, traceId)

    await trx
      .updateTable('notes')
      .set({ last_run: JSON.stringify(makePointerLastRun(traceId)) as any })
      .where('id', '=', note.id)
      .execute()

    const res = await server('/api/notes?folder=/project-a', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toHaveLength(1)
    const extraction = body[0].lastRun.extraction
    expect(extraction.trace_id).toBeUndefined()
    expect(extraction.messages).toBeUndefined()
    expect(extraction.response).toBeUndefined()
  })

  test('note detail falls back to inline payload for legacy last_run without trace_id', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const { note } = await seedNotesDomain(trx, workspace.id)

    await trx
      .updateTable('notes')
      .set({ last_run: JSON.stringify(makeLegacyLastRun()) as any })
      .where('id', '=', note.id)
      .execute()

    const res = await server('/api/notes/project-a/plan.md', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.lastRun.extraction.messages).toEqual([
      { role: 'system', content: 'inline' },
      { role: 'user', content: 'legacy' },
    ])
    expect(body.lastRun.extraction.response).toBe('{"concepts":[]}')
  })
})
