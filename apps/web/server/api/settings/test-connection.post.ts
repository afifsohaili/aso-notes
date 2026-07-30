import process from 'node:process'
import { resolveEmbeddingProvider, resolveLLMProvider } from '../../lib/ai/registry'
import { EMBEDDING_DIMENSIONS } from '../../lib/ai/types'

function validateRole(value: unknown): 'agent' | 'extraction' | 'embedding' {
  if (value === 'agent' || value === 'extraction' || value === 'embedding')
    return value
  throw createError({ statusCode: 400, message: 'role must be \'agent\', \'extraction\', or \'embedding\'' })
}

function validateProvider(value: unknown): 'openrouter' | 'ollama' {
  if (value === 'openrouter' || value === 'ollama')
    return value
  throw createError({ statusCode: 400, message: 'provider must be \'openrouter\' or \'ollama\'' })
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  }
  finally {
    clearTimeout(timeout)
  }
}

/**
 * Test a live provider/model combination without saving it.
 *
 * - Chat roles (agent/extraction): one minimal completion.
 * - Embedding: probe with one tiny input, no `dimensions` param, and accept
 *   only the graph-store width (2048). Mismatch is a validation outcome
 *   returned as `{ ok: false, dims, expected: 2048 }`, not a server error.
 * - All other errors (auth, unreachable, unknown model) are returned as
 *   `{ ok: false, error }`. 4xx is reserved for malformed requests/authz.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)

  try {
    const role = validateRole(body?.role)
    const provider = validateProvider(body?.provider)
    const rawModel = body?.model
    const model = typeof rawModel === 'string' ? rawModel.trim() : ''
    if (model.length === 0) {
      throw createError({ statusCode: 400, message: 'model must be a non-empty string' })
    }
    const baseUrl = body?.base_url
    if (baseUrl !== undefined && baseUrl !== null && typeof baseUrl !== 'string') {
      throw createError({ statusCode: 400, message: 'base_url must be a string' })
    }

    const env = process.env
    const settings = { provider, model, base_url: baseUrl }
    const timeoutMs = provider === 'ollama' ? 30000 : 15000

    if (role === 'agent' || role === 'extraction') {
      const resolved = resolveLLMProvider(role, env, settings, { timeoutMs, maxAttempts: 1 })
      await resolved.provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 1,
      })
      return { ok: true }
    }

    // Embedding role
    const resolved = resolveEmbeddingProvider(env, settings, { timeoutMs, maxAttempts: 1 })

    if (resolved.kind === 'openrouter') {
      const embeddings = await resolved.provider.embed(['dimension probe'])
      const dims = embeddings[0].length
      if (dims !== EMBEDDING_DIMENSIONS) {
        return { ok: false, dims, expected: EMBEDDING_DIMENSIONS }
      }
      return { ok: true }
    }

    // Ollama embedding: raw /api/embed without dimensions param.
    const response = await fetchWithTimeout(
      `${resolved.baseUrl}/api/embed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: resolved.model, input: 'dimension probe' }),
      },
      timeoutMs,
    )
    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: `Ollama returned ${response.status}: ${text}` }
    }
    const payload = await response.json() as { embeddings: number[][] }
    const dims = payload.embeddings[0]?.length ?? 0
    if (dims !== EMBEDDING_DIMENSIONS) {
      return { ok: false, dims, expected: EMBEDDING_DIMENSIONS }
    }
    return { ok: true }
  }
  catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as any).statusCode === 400) {
      throw err
    }
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
})
