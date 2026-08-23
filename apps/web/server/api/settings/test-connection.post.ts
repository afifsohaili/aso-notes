import process from 'node:process'
import { OverDimensionsError } from '../../lib/ai/normalize-embedding'
import { resolveEmbeddingProvider, resolveLLMProvider } from '../../lib/ai/registry'
import { EMBEDDING_DIMENSIONS } from '../../lib/ai/types'

function validateRole(value: unknown): 'agent' | 'extraction' | 'embedding' {
  if (value === 'agent' || value === 'extraction' || value === 'embedding')
    return value
  throw createError({ statusCode: 400, message: 'role must be \'agent\', \'extraction\', or \'embedding\'' })
}

function validateProvider(value: unknown): 'openrouter' | 'ollama' | 'omlx' {
  if (value === 'openrouter' || value === 'ollama' || value === 'omlx')
    return value
  throw createError({ statusCode: 400, message: 'provider must be \'openrouter\', \'ollama\' or \'omlx\'' })
}

/**
 * Test a live provider/model combination without saving it.
 *
 * - Chat (agent/extraction): one minimal completion.
 * - Embedding: probe with one tiny input. The adapter requests
 *   `dimensions: 2048` from the provider (native Matryoshka truncation where
 *   supported), zero-pads sub-2048 output, and throws when native output
 *   exceeds 2048. So a successful embed() call means the model can reach
 *   2048 and is accepted. A >2048 native model surfaces as a clear,
 *   user-facing "unsupported" error.
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
    const timeoutMs = provider === 'ollama' || provider === 'omlx' ? 30000 : 15000

    if (role === 'agent' || role === 'extraction') {
      const resolved = resolveLLMProvider(role, env, settings, { timeoutMs, maxAttempts: 1 })
      await resolved.provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 1,
      })
      return { ok: true }
    }

    // Embedding role. All three providers go through the adapter, which
    // requests `dimensions: 2048` and normalizes output to exactly 2048
    // (native truncation, zero-pad for sub-2048, throw for >2048). A
    // successful embed() therefore proves the model can reach 2048.
    const resolved = resolveEmbeddingProvider(env, settings, { timeoutMs, maxAttempts: 1 })
    await resolved.provider.embed(['dimension probe'])
    return { ok: true }
  }
  catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as any).statusCode === 400) {
      throw err
    }
    if (err instanceof OverDimensionsError) {
      return {
        ok: false,
        error: `This model's native embedding exceeds the supported ${EMBEDDING_DIMENSIONS} dimensions — it is unsupported. Pick a model that outputs at most ${EMBEDDING_DIMENSIONS} dimensions.`,
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
})
