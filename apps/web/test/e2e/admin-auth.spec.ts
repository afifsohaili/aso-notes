import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('admin middleware protection', () => {
  test('returns 401 when accessing admin routes without auth', async ({ server }) => {
    const res = await server('/api/admin/notifications')
    expect(res.status).toBe(401)
  })

  test('returns 403 when non-admin user accesses admin routes', async ({ server }) => {
    const { cookies } = await givenVerifiedUser({ email: `regular-${Date.now()}@example.com` })

    const res = await server('/api/admin/notifications', {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(403)
  })
})
