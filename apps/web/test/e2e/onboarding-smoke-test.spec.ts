import type { CompletionRequest, EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import {
  resetSmokeTestAttempts,
  SMOKE_TEST_FILENAME,
} from '../../server/lib/onboarding/smoke-test'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { createStageRegistry } from '../../server/lib/pipeline/singleton'
import { handleFileUnlink, handleFileUpsert } from '../../server/lib/sync/files'
import { ingestNote } from '../../server/lib/sync/ingest'
import { settledPendingNotesQuery } from '../../server/lib/sync/sweeper'
import { ensureNotesGraphCatalog } from './age-catalog'

/**
 * E2E feature spec: the onboarding smoke test writes a file into the first
 * synced folder, the sync fast path creates a note row, ingestion succeeds,
 * the endpoint deletes the file, and the unlink flow removes the row before
 * flipping onboarding.completed_at.
 *
 * The ingestion pipeline still uses raw BullMQ, so the queue fixture's inline
 * adapter cannot consume it. We drive the same ingestion handler the worker
 * calls, with stubbed LLM/embedding providers, inside the test transaction.
 */

const SMOKE_EXTRACTION = {
  concepts: [
    { name: 'Smoke test', description: 'an onboarding verification note', topics: ['Verification'] },
  ],
  relations: [],
  mentions: [{ concept: 'Smoke test', chunkRefs: [0] }],
  tags: [],
  topics: [{ name: 'Verification', description: 'onboarding verification topics' }],
}

function stubEmbeddingProvider(): { calls: string[][], provider: EmbeddingProvider } {
  const calls: string[][] = []
  const provider: EmbeddingProvider = {
    async embed(texts) {
      calls.push(texts)
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01) as number[])
    },
  }
  return { calls, provider }
}

function stubLLM(payload: object): { requests: CompletionRequest[], provider: LLMProvider } {
  const requests: CompletionRequest[] = []
  const provider: LLMProvider = {
    async complete(request) {
      requests.push(request)
      return { message: { role: 'assistant', content: JSON.stringify(payload) } }
    },
  }
  return { requests, provider }
}

function createFakeIngest(trx: any) {
  const embedding = stubEmbeddingProvider()
  const llm = stubLLM(SMOKE_EXTRACTION)
  const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider: embedding.provider })
  return async (noteId: string) => {
    await ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES } })
  }
}

describe('pOST /api/onboarding/smoke-test', () => {
  test('returns 401 for anonymous requests', async ({ server }) => {
    const res = await server('/api/onboarding/smoke-test', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('returns 409 when NUXT_REDIS_URL is not set', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    vi.stubEnv('NUXT_REDIS_URL', '')

    const dir = path.join(os.tmpdir(), `aso-smoke-no-redis-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    try {
      await addSyncedFolder(server, cookies, dir)

      const res = await server('/api/onboarding/smoke-test', {
        method: 'POST',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(409)
      const body = await res.json() as { code: string }
      expect(body.code).toBe('redis_required')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })

  test('returns 409 when no synced folder exists', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const res = await server('/api/onboarding/smoke-test', {
      method: 'POST',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('no_synced_folder')
  })
})

describe('gET /api/onboarding/smoke-test', () => {
  test('returns 401 for anonymous requests', async ({ server }) => {
    const res = await server('/api/onboarding/smoke-test?attemptId=x')
    expect(res.status).toBe(401)
  })

  test('returns 400 when attemptId is missing', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const res = await server('/api/onboarding/smoke-test', {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(400)
  })
})

describe('onboarding smoke test end-to-end', () => {
  let cookies: string
  let workspaceId: string
  let folderId: string
  let dir: string
  let filePath: string

  beforeEach(async ({ server, trx }) => {
    resetSmokeTestAttempts()

    const { cookies: userCookies, workspace } = await givenVerifiedUser()
    cookies = userCookies
    workspaceId = workspace.id

    dir = path.join(os.tmpdir(), `aso-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(dir, { recursive: true })
    filePath = path.join(dir, SMOKE_TEST_FILENAME)

    await addSyncedFolder(server, cookies, dir)
    const folder = await trx
      .selectFrom('synced_folders')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirstOrThrow()
    folderId = folder.id

    await ensureNotesGraphCatalog(trx)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  test('writes a test note, ingests it, deletes it, and completes onboarding', async ({ server, trx }) => {
    const postRes = await server('/api/onboarding/smoke-test', {
      method: 'POST',
      headers: { cookie: cookies },
    })
    expect(postRes.status).toBe(200)
    const { attemptId, phase } = await postRes.json() as { attemptId: string, phase: string }
    expect(attemptId).toBeTruthy()
    expect(phase).toBe('written')
    expect(existsSync(filePath)).toBe(true)

    await handleFileUpsert({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const pendingRes = await server(`/api/onboarding/smoke-test?attemptId=${attemptId}`, {
      headers: { cookie: cookies },
    })
    expect(pendingRes.status).toBe(200)
    const pendingState = await pendingRes.json() as { phase: string }
    expect(pendingState.phase).toBe('pending')

    const note = await findSmokeTestNote(trx, folderId)
    expect(note).not.toBeNull()
    await createFakeIngest(trx)(note!.id)

    const ingestedNote = await findSmokeTestNote(trx, folderId)
    expect(ingestedNote).not.toBeNull()
    expect(ingestedNote!.status).toBe('ingested')

    const ingestedRes = await server(`/api/onboarding/smoke-test?attemptId=${attemptId}`, {
      headers: { cookie: cookies },
    })
    expect(ingestedRes.status).toBe(200)
    const ingestedState = await ingestedRes.json() as { phase: string }
    expect(ingestedState.phase).toBe('ingested')
    expect(existsSync(filePath)).toBe(false)

    await handleFileUnlink({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const doneRes = await server(`/api/onboarding/smoke-test?attemptId=${attemptId}`, {
      headers: { cookie: cookies },
    })
    expect(doneRes.status).toBe(200)
    const doneState = await doneRes.json() as { phase: string }
    expect(doneState.phase).toBe('done')

    const gone = await findSmokeTestNote(trx, folderId)
    expect(gone).toBeUndefined()

    const completed = await trx
      .selectFrom('workspace_settings')
      .select('value')
      .where('key', '=', 'onboarding.completed_at')
      .executeTakeFirst()
    expect(completed).not.toBeUndefined()
    expect(typeof completed?.value).toBe('string')
  })

  test('marks the smoke note settle-eligible so the sweeper dispatches it within the timeout', async ({ server, trx }) => {
    // Browser-verification bug (Phase 7b): the sweeper only dispatches notes
    // untouched for PENDING_SETTLE_INTERVAL (5 min) but the smoke test times
    // out after 3, so the verify step could never pass against the real
    // daemon. The GET poll must backdate the smoke note's updated_at so the
    // NORMAL sweep path picks it up.
    const postRes = await server('/api/onboarding/smoke-test', {
      method: 'POST',
      headers: { cookie: cookies },
    })
    expect(postRes.status).toBe(200)
    const { attemptId } = await postRes.json() as { attemptId: string }

    await handleFileUpsert({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const pendingRes = await server(`/api/onboarding/smoke-test?attemptId=${attemptId}`, {
      headers: { cookie: cookies },
    })
    expect(pendingRes.status).toBe(200)
    expect((await pendingRes.json() as { phase: string }).phase).toBe('pending')

    const note = await findSmokeTestNote(trx, folderId)
    expect(note).not.toBeNull()

    const settled = await settledPendingNotesQuery(trx, workspaceId).execute()
    expect(settled.map(row => row.id)).toContain(note!.id)
  })

  test('surfaces ingestion failure and allows retry', async ({ server, trx }) => {
    const postRes = await server('/api/onboarding/smoke-test', {
      method: 'POST',
      headers: { cookie: cookies },
    })
    expect(postRes.status).toBe(200)
    const { attemptId } = await postRes.json() as { attemptId: string }

    await handleFileUpsert({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const note = await findSmokeTestNote(trx, folderId)
    expect(note).not.toBeUndefined()

    const failingLLM: LLMProvider = {
      async complete() {
        throw new Error('extraction model is down')
      },
    }
    const embedding = stubEmbeddingProvider()
    const failingRegistry = createStageRegistry({ llmProvider: failingLLM, embeddingProvider: embedding.provider })
    await expect(
      ingestNote({ db: trx, noteId: note!.id, options: { registry: failingRegistry, pipelines: PIPELINES } }),
    ).rejects.toThrow('extraction model is down')

    const failedRes = await server(`/api/onboarding/smoke-test?attemptId=${attemptId}`, {
      headers: { cookie: cookies },
    })
    expect(failedRes.status).toBe(200)
    const failedState = await failedRes.json() as { phase: string, error: string }
    expect(failedState.phase).toBe('failed')
    expect(failedState.error).toContain('extraction model is down')

    const retryRes = await server('/api/onboarding/smoke-test', {
      method: 'POST',
      headers: { cookie: cookies },
    })
    expect(retryRes.status).toBe(200)
    const { attemptId: retryId } = await retryRes.json() as { attemptId: string }
    expect(retryId).not.toBe(attemptId)
    expect(existsSync(filePath)).toBe(true)

    await handleFileUpsert({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const retryNote = await findSmokeTestNote(trx, folderId)
    expect(retryNote).not.toBeUndefined()
    await createFakeIngest(trx)(retryNote!.id)

    const ingestedRes = await server(`/api/onboarding/smoke-test?attemptId=${retryId}`, {
      headers: { cookie: cookies },
    })
    expect(ingestedRes.status).toBe(200)
    const ingestedState = await ingestedRes.json() as { phase: string }
    expect(ingestedState.phase).toBe('ingested')

    await handleFileUnlink({
      db: trx,
      workspaceId,
      syncedFolderId: folderId,
      notesDir: dir,
      absolutePath: filePath,
    })

    const doneRes = await server(`/api/onboarding/smoke-test?attemptId=${retryId}`, {
      headers: { cookie: cookies },
    })
    expect(doneRes.status).toBe(200)
    const doneState = await doneRes.json() as { phase: string }
    expect(doneState.phase).toBe('done')
  })
})

async function addSyncedFolder(server: (path: string, init?: RequestInit) => Promise<Response>, cookies: string, dir: string): Promise<void> {
  const res = await server('/api/synced-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': cookies },
    body: JSON.stringify({ path: dir }),
  })
  expect(res.status).toBe(200)
}

async function findSmokeTestNote(trx: any, folderId: string) {
  return trx
    .selectFrom('notes')
    .select(['id', 'status', 'last_run'])
    .where('synced_folder_id', '=', folderId)
    .where('path', '=', `/${SMOKE_TEST_FILENAME}`)
    .executeTakeFirst()
}
