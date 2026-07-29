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

      expect(body).toEqual({
        settings: {
          'extraction.vocabulary_strategy': { value: 'top-k', source: 'default' },
          'extraction.blind_merge_threshold': { value: 0.85, source: 'default' },
        },
      })
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
      expect(body.settings['extraction.vocabulary_strategy']).toEqual({ value: 'top-k', source: 'default' })
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
      expect(body.settings['extraction.vocabulary_strategy']).toEqual({ value: 'top-k', source: 'default' })
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
  })
})
