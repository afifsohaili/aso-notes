import { fetch, setup } from '@nuxt/test-utils/e2e'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'dotenv/config'

describe('admin middleware protection', async () => {
  await setup({
    host: process.env.TEST_HOST,
  })

  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  let authCookies: string
  let testUserEmail: string

  beforeAll(async () => {
    // Create a regular user (not admin)
    testUserEmail = `test-regular-${Date.now()}@example.com`
    const signupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': process.env.TEST_HOST || 'http://localhost:3000',
      },
      body: JSON.stringify({
        email: testUserEmail,
        password: 'TestPass123!',
        name: 'Test Regular User',
      }),
    })

    if (!signupRes.ok) {
      throw new Error(`Signup failed: ${await signupRes.text()}`)
    }

    // Verify email
    await db.query(
      'UPDATE users SET "emailVerified" = true WHERE email = $1',
      [testUserEmail],
    )

    // Sign in to get session
    const loginRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': process.env.TEST_HOST || 'http://localhost:3000',
      },
      body: JSON.stringify({
        email: testUserEmail,
        password: 'TestPass123!',
      }),
    })

    if (!loginRes.ok) {
      throw new Error(`Login failed: ${await loginRes.text()}`)
    }

    // Extract cookies - only keep name=value part
    const setCookies = loginRes.headers.getSetCookie?.() ?? []
    authCookies = setCookies.map(c => c.split(';')[0]).join('; ')
  })

  afterAll(async () => {
    // Cleanup - delete sessions first due to FK constraint
    await db.query('DELETE FROM sessions WHERE "userId" IN (SELECT id FROM users WHERE email = $1)', [testUserEmail])
    await db.query('DELETE FROM accounts WHERE "userId" IN (SELECT id FROM users WHERE email = $1)', [testUserEmail])
    await db.query('DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [testUserEmail])
    await db.query('DELETE FROM users WHERE email = $1', [testUserEmail])
    await db.end()
  })

  it('returns 401 when accessing admin routes without auth', async () => {
    const res = await fetch('/api/admin/notifications')
    expect(res.status).toBe(401)
  })

  it('returns 403 when non-admin user accesses admin routes', async () => {
    const res = await fetch('/api/admin/notifications', {
      headers: { Cookie: authCookies },
    })
    expect(res.status).toBe(403)
  })
})
