import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

const API_KEY_ENV_VARS = [
  'NUXT_LLM_AGENT_API_KEY',
  'NUXT_LLM_EXTRACTION_API_KEY',
  'NUXT_LLM_EMBEDDING_API_KEY',
] as const

describe('gET /api/settings/providers', () => {
  test('returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/settings/providers')
    expect(res.status).toBe(401)
  })

  test('shows openrouter only for roles with an env API key', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()

    const original: Record<string, string | undefined> = {}
    for (const key of API_KEY_ENV_VARS) {
      original[key] = process.env[key]
      process.env[key] = ''
    }

    try {
      const res = await server('/api/settings/providers', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.providers).toEqual({
        agent: { openrouter: false, ollama: true },
        extraction: { openrouter: false, ollama: true },
        embedding: { openrouter: false, ollama: true },
      })

      process.env.NUXT_LLM_AGENT_API_KEY = 'sk-test-agent'

      const res2 = await server('/api/settings/providers', { headers: { cookie: cookies } })
      expect(res2.status).toBe(200)
      const body2 = await res2.json()

      expect(body2.providers.agent).toEqual({ openrouter: true, ollama: true })
      expect(body2.providers.extraction).toEqual({ openrouter: false, ollama: true })
      expect(body2.providers.embedding).toEqual({ openrouter: false, ollama: true })
    }
    finally {
      for (const key of API_KEY_ENV_VARS) {
        process.env[key] = original[key]
      }
    }
  })
})
