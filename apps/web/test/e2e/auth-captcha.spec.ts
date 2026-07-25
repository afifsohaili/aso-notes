import { test } from '@base/testing/test'
import { describe, expect, vi } from 'vitest'

describe('pOST /api/auth/captcha', () => {
  test('returns 400 when token is missing and NODE_ENV is not development', async ({ server }) => {
    vi.stubEnv('NODE_ENV', 'production')

    const res = await server('/api/auth/captcha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })

  test('returns success without a token in development', async ({ server }) => {
    vi.stubEnv('NODE_ENV', 'development')

    const res = await server('/api/auth/captcha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
