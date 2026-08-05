import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('settings API', () => {
  describe('gET /api/settings', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/settings')
      expect(res.status).toBe(401)
    })

    test('returns defaults with source default on a fresh workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const res = await server('/api/settings', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.settings['extraction.vocabulary_strategy']).toEqual({ value: 'full', source: 'default' })
      expect(body.settings['extraction.blind_merge_threshold']).toEqual({ value: 0.85, source: 'default' })
      expect(body.settings['consolidation.run_budget']).toEqual({ value: 200, source: 'default' })
      expect(body.settings['llm.agent.provider']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.agent.model']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.agent.base_url']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.embedding.provider']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.embedding.model']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.embedding.base_url']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['llm.consolidation.model']).toEqual({ value: expect.any(String), source: 'default' })
      expect(body.settings['onboarding.completed_at']).toEqual({ value: null, source: 'default' })
    })
  })

  describe('pATCH /api/settings', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'extraction.vocabulary_strategy', value: 'blind-merge' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(res.status).toBe(401)
    })

    test('persists a valid setting and GET reflects it with source workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'extraction.vocabulary_strategy', value: 'blind-merge' }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(200)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      expect(getRes.status).toBe(200)
      const body = await getRes.json()

      expect(body.settings['extraction.vocabulary_strategy']).toEqual({
        value: 'blind-merge',
        source: 'workspace',
      })
      expect(body.settings['extraction.blind_merge_threshold']).toEqual({
        value: 0.85,
        source: 'default',
      })
    })

    test('rejects an unknown key with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'unknown.key', value: 'anything' }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['extraction.vocabulary_strategy']).toEqual({ value: 'full', source: 'default' })
    })

    test('rejects an invalid strategy with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'extraction.vocabulary_strategy', value: 'nearest-neighbor' }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['extraction.vocabulary_strategy']).toEqual({ value: 'full', source: 'default' })
    })

    test('rejects an out-of-range threshold with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'extraction.blind_merge_threshold', value: 1.5 }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['extraction.blind_merge_threshold']).toEqual({ value: 0.85, source: 'default' })
    })

    test('persists a valid threshold and GET reflects it with source workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'extraction.blind_merge_threshold', value: 0.92 }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(200)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['extraction.blind_merge_threshold']).toEqual({ value: 0.92, source: 'workspace' })
    })

    test('persists llm provider and model keys and GET reflects them with source workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const keys = [
        { key: 'llm.agent.provider', value: 'ollama' },
        { key: 'llm.agent.model', value: 'gemma3:4b' },
        { key: 'llm.agent.base_url', value: 'http://localhost:11434' },
        { key: 'llm.extraction.provider', value: 'ollama' },
        { key: 'llm.extraction.model', value: 'qwen2.5:7b' },
        { key: 'llm.embedding.provider', value: 'ollama' },
        { key: 'llm.embedding.model', value: 'nomic-embed-text' },
        { key: 'llm.consolidation.provider', value: 'ollama' },
        { key: 'llm.consolidation.model', value: 'gemma3:4b' },
      ]

      for (const { key, value } of keys) {
        const patchRes = await server('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ key, value }),
          headers: { 'cookie': cookies, 'content-type': 'application/json' },
        })
        const text = await patchRes.text()
        expect(patchRes.status).toBe(200)
        if (!patchRes.ok)
          throw new Error(text)
      }

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      expect(getRes.status).toBe(200)
      const body = await getRes.json()

      expect(body.settings['llm.agent.provider']).toEqual({ value: 'ollama', source: 'workspace' })
      expect(body.settings['llm.agent.model']).toEqual({ value: 'gemma3:4b', source: 'workspace' })
      expect(body.settings['llm.agent.base_url']).toEqual({ value: 'http://localhost:11434', source: 'workspace' })
      expect(body.settings['llm.extraction.provider']).toEqual({ value: 'ollama', source: 'workspace' })
      expect(body.settings['llm.embedding.provider']).toEqual({ value: 'ollama', source: 'workspace' })
      expect(body.settings['llm.embedding.model']).toEqual({ value: 'nomic-embed-text', source: 'workspace' })
      expect(body.settings['llm.consolidation.provider']).toEqual({ value: 'ollama', source: 'workspace' })
      expect(body.settings['llm.consolidation.model']).toEqual({ value: 'gemma3:4b', source: 'workspace' })
    })

    test('persists consolidation.run_budget and GET reflects it with source workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'consolidation.run_budget', value: 500 }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(200)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      expect(getRes.status).toBe(200)
      const body = await getRes.json()
      expect(body.settings['consolidation.run_budget']).toEqual({ value: 500, source: 'workspace' })
    })

    test('rejects an invalid consolidation.run_budget with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'consolidation.run_budget', value: -5 }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['consolidation.run_budget']).toEqual({ value: 200, source: 'default' })
    })

    test('rejects an invalid llm provider with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'llm.agent.provider', value: 'mistral' }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['llm.agent.provider'].source).toBe('default')
    })

    test('rejects an empty llm model with 400 and does not persist', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'llm.embedding.model', value: '   ' }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(400)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['llm.embedding.model'].source).toBe('default')
    })

    test('persists and clears onboarding.completed_at', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()

      const timestamp = '2026-07-30T12:00:00.000Z'
      const patchRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'onboarding.completed_at', value: timestamp }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(patchRes.status).toBe(200)

      const getRes = await server('/api/settings', { headers: { cookie: cookies } })
      const body = await getRes.json()
      expect(body.settings['onboarding.completed_at']).toEqual({ value: timestamp, source: 'workspace' })

      const clearRes = await server('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'onboarding.completed_at', value: null }),
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
      })
      expect(clearRes.status).toBe(200)

      const getRes2 = await server('/api/settings', { headers: { cookie: cookies } })
      const body2 = await getRes2.json()
      expect(body2.settings['onboarding.completed_at']).toEqual({ value: null, source: 'default' })
    })
  })
})
