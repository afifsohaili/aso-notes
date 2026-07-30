import type { LLMProvider } from '../../server/lib/ai/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { FatalError, RateLimitError, TransientError } from '../../server/lib/ai/resilient-fetch'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { parseLastRun } from '../../server/lib/pipeline/last-run'
import { createStageRegistry } from '../../server/lib/pipeline/singleton'
import { ingestNote } from '../../server/lib/sync/ingest'

/**
 * Phase 3 resilience feature spec: ingestNote's error classification at the
 * BullMQ worker boundary. The worker processor maps these typed errors to
 * BullMQ control errors (see ingestion-worker-error-policy.unit.spec.ts); here
 * we assert the observable DB state for each classification.
 */

const NOTE_CONTENT = '# Test\n\nalpha '.repeat(50)

function stubEmbeddingProvider() {
  const provider = {
    async embed(texts: string[]) {
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01))
    },
  }
  return { provider }
}

function failingLLM(error: Error): LLMProvider {
  return {
    async complete() {
      throw error
    },
  }
}

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, content: string) {
  return trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content,
      content_hash: `hash-${path}`,
      pipeline: 'markdown-note-with-links',
    })
    .returning(['id', 'content_hash'])
    .executeTakeFirstOrThrow()
}

async function runIngest(trx: any, noteId: string, llm: LLMProvider) {
  const embedding = stubEmbeddingProvider()
  const registry = createStageRegistry({ llmProvider: llm, embeddingProvider: embedding.provider })
  return ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES } })
}

async function getStatusAndLastRun(trx: any, noteId: string) {
  return trx
    .selectFrom('notes')
    .select(['status', 'last_run'])
    .where('id', '=', noteId)
    .executeTakeFirstOrThrow()
}

describe('ingestion resilience: error classification', () => {
  test('RateLimitError leaves the note in processing and records the attempt', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'resilience-rate-limit')
    const note = await givenNote(trx, workspaceId, '/rate-limit.md', NOTE_CONTENT)

    await expect(
      runIngest(trx, note.id, failingLLM(new RateLimitError('rate limited', 5000, { limit: '20' }))),
    ).rejects.toThrow(RateLimitError)

    const after = await getStatusAndLastRun(trx, note.id)
    expect(after.status).toBe('processing')

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('failed')
    expect(lastRun!.error).toMatchObject({ name: 'RateLimitError', message: 'rate limited' })
  })

  test('FatalError marks the note failed and records the attempt', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'resilience-fatal')
    const note = await givenNote(trx, workspaceId, '/fatal.md', NOTE_CONTENT)

    await expect(
      runIngest(trx, note.id, failingLLM(new FatalError('invalid request'))),
    ).rejects.toThrow(FatalError)

    const after = await getStatusAndLastRun(trx, note.id)
    expect(after.status).toBe('failed')

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('failed')
    expect(lastRun!.error).toMatchObject({ name: 'FatalError', message: 'invalid request' })
  })

  test('TransientError marks the note failed so BullMQ can retry it normally', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'resilience-transient')
    const note = await givenNote(trx, workspaceId, '/transient.md', NOTE_CONTENT)

    await expect(
      runIngest(trx, note.id, failingLLM(new TransientError('server error'))),
    ).rejects.toThrow(TransientError)

    const after = await getStatusAndLastRun(trx, note.id)
    expect(after.status).toBe('failed')

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('failed')
    expect(lastRun!.error).toMatchObject({ name: 'TransientError', message: 'server error' })
  })
})
