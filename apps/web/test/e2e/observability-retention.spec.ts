import { randomUUID } from 'node:crypto'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { purgeOrphanTraceContent, purgeTraceContentForOwner, runObservabilityRetentionSweep } from '../../server/lib/observability/retention'
import { removeSyncedFolderAndCollectGarbage } from '../../server/lib/sync/gc'
import { ensureNotesGraphCatalog } from './age-catalog'

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenTrace(trx: any, workspaceId: string, ownerType: string, ownerId: string, kind: string = 'chat') {
  const row = await trx
    .insertInto('llm_traces')
    .values({
      workspace_id: workspaceId,
      kind,
      owner_type: ownerType,
      owner_id: ownerId,
      status: 'completed',
      started_at: new Date(),
      finished_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenGeneration(
  trx: any,
  traceId: string,
  workspaceId: string,
  seq: number,
  overrides: { createdAt?: Date, prompt?: unknown, response?: unknown } = {},
) {
  const row = await trx
    .insertInto('llm_generations')
    .values({
      workspace_id: workspaceId,
      trace_id: traceId,
      seq,
      llm_use_case: 'agent',
      provider: 'openrouter',
      model: 'test-model',
      prompt: overrides.prompt !== undefined ? overrides.prompt : { text: 'prompt' },
      response: overrides.response !== undefined ? overrides.response : { text: 'response' },
      prompt_tokens: 10,
      completion_tokens: 5,
      cost_usd: '0.000100',
      latency_ms: 100,
      created_at: overrides.createdAt ?? new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenToolCall(
  trx: any,
  traceId: string,
  workspaceId: string,
  seq: number,
  overrides: { createdAt?: Date, output?: unknown, input?: unknown } = {},
) {
  const row = await trx
    .insertInto('llm_tool_calls')
    .values({
      workspace_id: workspaceId,
      trace_id: traceId,
      seq,
      name: 'read_note',
      input: overrides.input !== undefined ? overrides.input : { note_id: 'n-1' },
      output: overrides.output !== undefined ? overrides.output : { content: 'tool output' },
      duration_ms: 50,
      status: 'completed',
      created_at: overrides.createdAt ?? new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenSyncedFolder(trx: any, workspaceId: string, path: string) {
  const row = await trx
    .insertInto('synced_folders')
    .values({ workspace_id: workspaceId, path })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, syncedFolderId: string) {
  const row = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content: '# Test',
      content_hash: `hash-${path}`,
      pipeline: 'markdown-note-with-links',
      synced_folder_id: syncedFolderId,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNoteOwner(trx: any, workspaceId: string, prefix: string): Promise<string> {
  const syncedFolderId = await givenSyncedFolder(trx, workspaceId, `/tmp/${prefix}`)
  return givenNote(trx, workspaceId, `/${prefix}.md`, syncedFolderId)
}

async function setRetentionDays(trx: any, workspaceId: string, days: number) {
  await trx
    .insertInto('workspace_settings')
    .values({ workspace_id: workspaceId, key: 'observability.content_retention_days', value: days })
    .onConflict(oc => oc.columns(['workspace_id', 'key']).doUpdateSet({ value: days }))
    .execute()
}

async function selectGeneration(trx: any, id: string) {
  return trx.selectFrom('llm_generations').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
}

async function selectToolCall(trx: any, id: string) {
  return trx.selectFrom('llm_tool_calls').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
}

describe('observability retention', () => {
  test('purges old generation and tool call content but keeps metadata and rows', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-old')
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-old')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'ingestion')
    const old = await givenGeneration(trx, traceId, workspaceId, 0, {
      createdAt: new Date('2020-01-01T00:00:00Z'),
      prompt: { text: 'old prompt' },
      response: { text: 'old response' },
    })
    const oldTool = await givenToolCall(trx, traceId, workspaceId, 0, {
      createdAt: new Date('2020-01-01T00:00:00Z'),
      output: { content: 'old tool output' },
    })

    await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    const gen = await selectGeneration(trx, old)
    expect(gen.prompt).toBeNull()
    expect(gen.response).toBeNull()
    expect(gen.pruned_at).not.toBeNull()
    expect(gen.prompt_tokens).toBe(10)
    expect(gen.completion_tokens).toBe(5)
    expect(gen.cost_usd).toBe('0.000100')
    expect(gen.model).toBe('test-model')

    const tool = await selectToolCall(trx, oldTool)
    expect(tool.output).toBeNull()
    expect(tool.pruned_at).not.toBeNull()
    expect(tool.input).toEqual({ note_id: 'n-1' })
    expect(tool.status).toBe('completed')
  })

  test('leaves new content untouched', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-new')
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-new')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'ingestion')
    const recent = await givenGeneration(trx, traceId, workspaceId, 0, {
      createdAt: new Date('2021-01-01T00:00:00Z'),
      prompt: { text: 'new prompt' },
      response: { text: 'new response' },
    })
    const recentTool = await givenToolCall(trx, traceId, workspaceId, 0, {
      createdAt: new Date('2021-01-01T00:00:00Z'),
      output: { content: 'new tool output' },
    })

    await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    const gen = await selectGeneration(trx, recent)
    expect(gen.prompt).toEqual({ text: 'new prompt' })
    expect(gen.response).toEqual({ text: 'new response' })
    expect(gen.pruned_at).toBeNull()

    const tool = await selectToolCall(trx, recentTool)
    expect(tool.output).toEqual({ content: 'new tool output' })
    expect(tool.pruned_at).toBeNull()
  })

  test('respects per-workspace retention days', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'retention-a')
    const wsB = await givenWorkspace(trx, 'retention-b')
    await setRetentionDays(trx, wsA, 1)
    await setRetentionDays(trx, wsB, 365)

    const noteA = await givenNoteOwner(trx, wsA, 'retention-a')
    const traceA = await givenTrace(trx, wsA, 'notes', noteA, 'chat')
    const oldA = await givenGeneration(trx, traceA, wsA, 0, { createdAt: new Date('2020-12-31T00:00:00Z') })

    const noteB = await givenNoteOwner(trx, wsB, 'retention-b')
    const traceB = await givenTrace(trx, wsB, 'notes', noteB, 'chat')
    const oldB = await givenGeneration(trx, traceB, wsB, 0, { createdAt: new Date('2021-01-01T00:00:00Z') })

    await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    expect((await selectGeneration(trx, oldA)).pruned_at).not.toBeNull()
    expect((await selectGeneration(trx, oldB)).pruned_at).toBeNull()
  })

  test('falls back to default retention days when workspace setting is missing', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-default')
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-default')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'chat')
    const old = await givenGeneration(trx, traceId, workspaceId, 0, { createdAt: new Date('2020-01-01T00:00:00Z') })

    await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    expect((await selectGeneration(trx, old)).pruned_at).not.toBeNull()
  })

  test('applies the exact cutoff boundary: older than cutoff prunes, at or newer does not', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-boundary')
    await setRetentionDays(trx, workspaceId, 1)
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-boundary')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'ingestion')

    const now = new Date('2021-01-02T12:00:00.000Z')
    const cutoff = new Date('2021-01-01T12:00:00.000Z')
    const justBeforeCutoff = new Date(cutoff.getTime() - 1)

    const old = await givenGeneration(trx, traceId, workspaceId, 0, { createdAt: justBeforeCutoff })
    const fresh = await givenGeneration(trx, traceId, workspaceId, 1, { createdAt: cutoff })

    await runObservabilityRetentionSweep(trx, now)

    expect((await selectGeneration(trx, old)).pruned_at).not.toBeNull()
    expect((await selectGeneration(trx, fresh)).pruned_at).toBeNull()
  })

  test('reports zero pruning when tables are empty', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-empty')
    await setRetentionDays(trx, workspaceId, 1)

    const result = await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    expect(result.prunedByAge).toBe(0)
    expect(result.prunedOrphans).toBe(0)
  })

  test('daily retention sweep is idempotent', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-idempotent')
    await setRetentionDays(trx, workspaceId, 1)
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-idempotent')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'chat')
    await givenGeneration(trx, traceId, workspaceId, 0, { createdAt: new Date('2020-12-31T00:00:00Z') })

    const now = new Date('2021-01-02T00:00:00Z')
    const first = await runObservabilityRetentionSweep(trx, now)
    const second = await runObservabilityRetentionSweep(trx, now)

    expect(first.prunedByAge).toBeGreaterThan(0)
    expect(first.prunedOrphans).toBe(0)
    expect(second.prunedByAge).toBe(0)
    expect(second.prunedOrphans).toBe(0)
  })

  test('running traces survive age-based and orphan purges', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-running')
    await setRetentionDays(trx, workspaceId, 1)

    const missingNoteId = randomUUID()
    const runningTraceId = await givenTrace(trx, workspaceId, 'notes', missingNoteId, 'chat')
    // Override the trace to running so we can test it is skipped.
    await trx
      .updateTable('llm_traces')
      .set({ status: 'running' })
      .where('id', '=', runningTraceId)
      .execute()

    const runningGen = await givenGeneration(trx, runningTraceId, workspaceId, 0, {
      createdAt: new Date('2020-01-01T00:00:00Z'),
      prompt: { text: 'running prompt' },
      response: { text: 'running response' },
    })

    const result = await runObservabilityRetentionSweep(trx, new Date('2021-01-02T00:00:00Z'))

    // The owner is missing, but the trace is running so neither sweep should prune it.
    expect(result.prunedByAge).toBe(0)
    expect(result.prunedOrphans).toBe(0)

    const gen = await selectGeneration(trx, runningGen)
    expect(gen.prompt).toEqual({ text: 'running prompt' })
    expect(gen.response).toEqual({ text: 'running response' })
    expect(gen.pruned_at).toBeNull()
  })

  test('orphan sweep purges content for missing note owners', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-orphan-note')
    const missingNoteId = randomUUID()
    const traceId = await givenTrace(trx, workspaceId, 'notes', missingNoteId, 'ingestion')
    const gen = await givenGeneration(trx, traceId, workspaceId, 0, { prompt: { x: 1 }, response: { y: 2 } })

    await purgeOrphanTraceContent(trx)

    expect((await selectGeneration(trx, gen)).pruned_at).not.toBeNull()
  })

  test('orphan sweep purges content for missing conversation owners', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-orphan-conversation')
    const missingConversationId = randomUUID()
    const traceId = await givenTrace(trx, workspaceId, 'conversations', missingConversationId, 'chat')
    const gen = await givenGeneration(trx, traceId, workspaceId, 0, { prompt: { x: 1 }, response: { y: 2 } })

    await purgeOrphanTraceContent(trx)

    expect((await selectGeneration(trx, gen)).pruned_at).not.toBeNull()
  })

  test('orphan sweep purges content for missing consolidation run owners', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-orphan-run')
    const missingRunId = randomUUID()
    const traceId = await givenTrace(trx, workspaceId, 'consolidation_runs', missingRunId, 'consolidation')
    const gen = await givenGeneration(trx, traceId, workspaceId, 0, { prompt: { x: 1 }, response: { y: 2 } })

    await purgeOrphanTraceContent(trx)

    expect((await selectGeneration(trx, gen)).pruned_at).not.toBeNull()
  })

  test('does not prune orphan content when the owner still exists', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-no-orphan')
    const noteId = await givenNoteOwner(trx, workspaceId, 'retention-no-orphan')
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'chat')
    const gen = await givenGeneration(trx, traceId, workspaceId, 0, { prompt: { x: 1 }, response: { y: 2 } })

    await purgeOrphanTraceContent(trx)

    expect((await selectGeneration(trx, gen)).pruned_at).toBeNull()
  })

  test('purges trace content immediately when a note is deleted via synced folder removal', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'retention-owner-purge')
    const syncedFolderId = await givenSyncedFolder(trx, workspaceId, '/tmp/retention-test')
    await ensureNotesGraphCatalog(trx)
    const noteId = await givenNote(trx, workspaceId, '/test.md', syncedFolderId)
    const traceId = await givenTrace(trx, workspaceId, 'notes', noteId, 'ingestion')
    const gen = await givenGeneration(trx, traceId, workspaceId, 0, { prompt: { secret: 'note text' }, response: { ok: true } })
    const tool = await givenToolCall(trx, traceId, workspaceId, 0, { output: { secret: 'tool result' } })

    await removeSyncedFolderAndCollectGarbage(trx, workspaceId, syncedFolderId)

    const afterGen = await selectGeneration(trx, gen)
    expect(afterGen.prompt).toBeNull()
    expect(afterGen.response).toBeNull()
    expect(afterGen.pruned_at).not.toBeNull()

    const afterTool = await selectToolCall(trx, tool)
    expect(afterTool.output).toBeNull()
    expect(afterTool.pruned_at).not.toBeNull()

    const remainingNotes = await trx.selectFrom('notes').select('id').where('id', '=', noteId).execute()
    expect(remainingNotes).toHaveLength(0)
  })

  test('purgeTraceContentForOwner is scoped to the supplied workspace', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'owner-purge-a')
    const wsB = await givenWorkspace(trx, 'owner-purge-b')

    const syncedFolderA = await givenSyncedFolder(trx, wsA, '/tmp/owner-purge-a')
    const syncedFolderB = await givenSyncedFolder(trx, wsB, '/tmp/owner-purge-b')

    const sharedOwnerId = randomUUID()
    const noteA = await givenNote(trx, wsA, '/shared.md', syncedFolderA)
    const noteB = await givenNote(trx, wsB, '/shared.md', syncedFolderB)

    // Use the same owner_id for both workspaces to prove workspace scoping.
    const traceA = await givenTrace(trx, wsA, 'notes', sharedOwnerId, 'ingestion')
    const traceB = await givenTrace(trx, wsB, 'notes', sharedOwnerId, 'ingestion')

    const genA = await givenGeneration(trx, traceA, wsA, 0, { prompt: { secret: 'a' }, response: { ok: true } })
    const genB = await givenGeneration(trx, traceB, wsB, 0, { prompt: { secret: 'b' }, response: { ok: true } })

    await purgeTraceContentForOwner(trx, wsA, 'notes', sharedOwnerId)

    expect((await selectGeneration(trx, genA)).prompt).toBeNull()
    expect((await selectGeneration(trx, genB)).prompt).not.toBeNull()

    // Clean up the second note so the transaction rollback is tidy.
    await trx.deleteFrom('notes').where('id', 'in', [noteA, noteB]).execute()
  })
})
