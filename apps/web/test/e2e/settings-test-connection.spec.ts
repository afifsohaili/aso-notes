import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect, vi } from 'vitest'

function makeOllamaEmbeddingResponse(dims: number): Response {
  return new Response(JSON.stringify({
    model: 'nomic-embed-text',
    embeddings: [Array.from({ length: dims }).fill(0.1)],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function makeOllamaChatResponse(): Response {
  return new Response(JSON.stringify({
    model: 'gemma3:4b',
    message: { role: 'assistant', content: 'hi' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('pOST /api/settings/test-connection', () => {
  test('returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'agent', provider: 'ollama', model: 'gemma3:4b' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns 400 for malformed body', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const res = await server('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'invalid', provider: 'ollama', model: 'gemma3:4b' }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for empty model', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const res = await server('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'agent', provider: 'ollama', model: '   ' }),
    })
    expect(res.status).toBe(400)
  })

  test('succeeds for ollama chat role', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      expect(urlString).toContain('/api/chat')
      return makeOllamaChatResponse()
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'agent', provider: 'ollama', model: 'gemma3:4b' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('succeeds for ollama embedding with 2048 dims', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      expect(urlString).toContain('/api/embed')
      return makeOllamaEmbeddingResponse(2048)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'ollama', model: 'nomic-embed-text' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('returns ok:false with dims for non-2048 ollama embedding', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      expect(urlString).toContain('/api/embed')
      return makeOllamaEmbeddingResponse(768)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'ollama', model: 'nomic-embed-text' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: false, dims: 768, expected: 2048 })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('returns ok:false with error on unreachable ollama', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed')
    })

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'extraction', provider: 'ollama', model: 'gemma3:4b' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error).toContain('fetch failed')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
