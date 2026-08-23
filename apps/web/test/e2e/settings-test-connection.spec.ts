import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect, vi } from 'vitest'
import { normalizeFetchUrl } from './test-utils'

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

function makeOmlxChatResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function makeOmlxEmbeddingsResponse(dims: number): Response {
  return new Response(JSON.stringify({
    data: [{ index: 0, embedding: Array.from({ length: dims }).fill(0.1) }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function makeOpenAiEmbeddingsResponse(dims: number): Response {
  // OpenRouter serves the OpenAI wire format: { data: [{ index, embedding }] }.
  return new Response(JSON.stringify({
    data: [{ index: 0, embedding: Array.from({ length: dims }).fill(0.1) }],
    usage: { prompt_tokens: 3, total_tokens: 3 },
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
      expect(normalizeFetchUrl(url)).toContain('/api/chat')
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

  test('succeeds for ollama embedding with native 2048 dims, requesting dimensions:2048', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/api/embed')
      const body = JSON.parse(String(init?.body))
      expect(body.dimensions).toBe(2048)
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

  test('accepts ollama embedding that ignores dimensions and returns sub-2048 (padded to 2048)', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/api/embed')
      const body = JSON.parse(String(init?.body))
      expect(body.dimensions).toBe(2048)
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
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('rejects ollama model whose native output exceeds 2048 with a clear error', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/api/embed')
      return makeOllamaEmbeddingResponse(4096)
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
      expect(body.ok).toBe(false)
      expect(body.error).toContain('exceed')
      expect(body.error).toContain('2048')
      expect(body.error).toContain('unsupported')
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

  test('succeeds for omlx chat role', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/v1/chat/completions')
      return makeOmlxChatResponse()
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'agent', provider: 'omlx', model: 'mlx-community/llama-3.2-3b' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('succeeds for omlx embedding with native 2048 dims, requesting dimensions:2048', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/v1/embeddings')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('mlx-community/all-MiniLM-L6-v2')
      expect(body.input).toEqual(['dimension probe'])
      expect(body.dimensions).toBe(2048)
      return makeOmlxEmbeddingsResponse(2048)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'omlx', model: 'mlx-community/all-MiniLM-L6-v2' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('accepts omlx embedding that ignores dimensions and returns sub-2048 (padded to 2048)', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/v1/embeddings')
      const body = JSON.parse(String(init?.body))
      expect(body.dimensions).toBe(2048)
      return makeOmlxEmbeddingsResponse(768)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'omlx', model: 'mlx-community/all-MiniLM-L6-v2' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('rejects omlx model whose native output exceeds 2048 with a clear error', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/v1/embeddings')
      return makeOmlxEmbeddingsResponse(4096)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'omlx', model: 'mlx-community/all-MiniLM-L6-v2' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error).toContain('exceed')
      expect(body.error).toContain('2048')
      expect(body.error).toContain('unsupported')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  test('rejects openrouter model whose native output exceeds 2048 with a clear error', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    vi.stubEnv('NUXT_LLM_EMBEDDING_API_KEY', 'sk-test-openrouter')
    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(normalizeFetchUrl(url)).toContain('/api/v1/embeddings')
      const body = JSON.parse(String(init?.body))
      expect(body.dimensions).toBe(2048)
      return makeOpenAiEmbeddingsResponse(4096)
    }
    vi.stubGlobal('fetch', fetchStub)

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'embedding', provider: 'openrouter', model: 'nvidia/nemotron-embed-4096' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error).toContain('exceed')
      expect(body.error).toContain('2048')
      expect(body.error).toContain('unsupported')
    }
    finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  test('returns ok:false with error on unreachable omlx', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed')
    })

    try {
      const res = await server('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'extraction', provider: 'omlx', model: 'mlx-community/llama-3.2-3b' }),
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
