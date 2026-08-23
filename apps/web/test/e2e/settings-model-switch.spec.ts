import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { ensureNotesGraphCatalog } from './age-catalog'

/**
 * End-to-end for the embedding model switch flow (ticket 04): the settings
 * UI warns before a changed embedding model is saved, then on confirm saves
 * the new model and triggers the rebuild endpoint, which resets notes to
 * pending for re-ingestion with the new model.
 *
 * The frontend calls the API in this order, so we exercise the same seam at
 * the API level: PATCH the embedding model, then POST rebuild.
 */

function makeOllamaEmbeddingResponse(): Response {
  // 2048-dim vectors — the embedding stubs must satisfy the 2048 target.
  return new Response(JSON.stringify({
    model: 'nomic-embed-text',
    embeddings: [Array.from({ length: 2048 }).fill(0.1)],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('settings embedding model switch', () => {
  beforeEach(() => {
    vi.stubEnv('NUXT_REDIS_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('persisting a new embedding model then rebuilding resets notes to pending', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    // Seed an ingested note so the rebuild has something to reset.
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        path: '/seed.md',
        title: 'Seed Note',
        content: '# Seed',
        content_hash: 'hash-seed',
        status: 'ingested',
      })
      .execute()

    // 1) Save the new embedding model (what the confirm path does).
    const patchRes = await server('/api/settings', {
      method: 'PATCH',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'llm.embedding.model', value: 'model-b' }),
    })
    expect(patchRes.status).toBe(200)

    // GET reflects the workspace override.
    const getRes = await server('/api/settings', { headers: { cookie: cookies } })
    expect(getRes.status).toBe(200)
    const body = await getRes.json()
    expect(body.settings['llm.embedding.model']).toEqual({ value: 'model-b', source: 'workspace' })

    // 2) Trigger the rebuild (what the confirm path does).
    const rebuildRes = await server('/api/settings/rebuild', {
      method: 'POST',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(rebuildRes.status).toBe(200)
    expect((await rebuildRes.json()).notesReset).toBe(1)

    // Notes transition to pending, ready to re-ingest with the new model.
    const notes = await trx
      .selectFrom('notes')
      .select('status')
      .where('workspace_id', '=', workspace.id)
      .execute()
    expect(notes).toEqual([expect.objectContaining({ status: 'pending' })])
  })

  test('test-connection with 2048-dim embedding stubs accepts a new model', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      expect(urlString).toContain('/api/embed')
      return makeOllamaEmbeddingResponse()
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'ollama', model: 'nomic-embed-text' }),
      })
      expect(res.status).toBe(200)
      const responseBody = await res.json()
      expect(responseBody).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
