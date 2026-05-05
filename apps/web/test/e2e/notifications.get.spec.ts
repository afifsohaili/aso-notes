import { readFileSync } from 'node:fs'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Load .env for direct DB access in test process
const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!process.env[key])
      process.env[key] = value
  }
}

describe('gET /api/notifications', async () => {
  // Use pre-started server if TEST_HOST is set, otherwise start a new one
  await setup({
    host: process.env.TEST_HOST,
  })

  const testEmail = `test-notif-${Date.now()}@example.com`
  let cookies = ''
  let userId = ''
  let orgId = ''
  let notificationIds: number[] = []

  const pool = new pg.Pool({
    connectionString: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL,
  })

  beforeAll(async () => {
    // Origin header required by BetterAuth when running against pre-started server
    const origin = process.env.TEST_HOST || 'http://localhost:3000'

    // Sign up a test user via BetterAuth
    // The afterSignUp hook creates an org + membership automatically
    const res = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        name: 'Test Notifications User',
        email: testEmail,
        password: 'TestPassword123!',
      }),
    })

    const body = await res.json()
    userId = body?.user?.id

    if (!userId) {
      throw new Error(`Sign-up failed: ${JSON.stringify(body)}`)
    }

    // Verify email (required for BetterAuth session to resolve with requireEmailVerification: true)
    await pool.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [userId])

    // Create org and membership manually (afterSignUp hook doesn't run when email verification is required)
    const { rows: orgRows } = await pool.query(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      ['Test Organization'],
    )
    orgId = orgRows[0].id
    await pool.query(
      'INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)',
      [userId, orgId, 'admin'],
    )

    // Sign in to get properly signed session cookies
    const signInRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPassword123!',
      }),
    })
    // Extract cookie name=value pairs from Set-Cookie headers
    const setCookies = signInRes.headers.getSetCookie?.() ?? []
    cookies = setCookies.map(c => c.split(';')[0]).join('; ')

    // Get org and role from the membership created by the signup hook
    const { rows: memberships } = await pool.query(
      'SELECT organization_id, role FROM memberships WHERE user_id = $1',
      [userId],
    )
    orgId = memberships[0]?.organization_id
    const userRole = memberships[0]?.role || 'member'

    if (!orgId) {
      throw new Error(`No membership found for user ${userId}. Memberships: ${JSON.stringify(memberships)}`)
    }

    // Seed test notifications using the actual user's role
    const { rows } = await pool.query(`
      INSERT INTO notifications (title, message, type, target_type, target_id, created_by, is_active)
      VALUES
        ('Org Notification', 'Visible to org members', 'info', 'organization', $1, $3, true),
        ('Role Notification', 'Visible to ${userRole}s', 'warning', 'role', $2, $3, true),
        ('Other Org Notification', 'Should not be visible', 'info', 'organization', 'non-existent-org', $3, true),
        ('Inactive Notification', 'Should not be visible', 'info', 'organization', $1, $3, false)
      RETURNING id
    `, [orgId, userRole, userId])
    notificationIds = rows.map((r: any) => r.id)
    if (notificationIds.length === 0) {
      throw new Error('Failed to seed notifications - insert returned no rows')
    }
  })

  afterAll(async () => {
    // Cleanup in FK-safe order
    if (notificationIds.length > 0) {
      await pool.query('DELETE FROM read_notifications WHERE notification_id = ANY($1::int[])', [notificationIds])
      await pool.query('DELETE FROM notifications WHERE id = ANY($1::int[])', [notificationIds])
    }
    if (userId) {
      await pool.query('DELETE FROM sessions WHERE "userId" = $1', [userId])
      await pool.query('DELETE FROM accounts WHERE "userId" = $1', [userId])
      await pool.query('DELETE FROM memberships WHERE user_id = $1', [userId])
      await pool.query('DELETE FROM users WHERE id = $1', [userId])
    }
    if (orgId) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId])
    }
    await pool.end()
  })

  it('returns 401 when not authenticated', async () => {
    const res = await fetch('/api/notifications')
    expect(res.status).toBe(401)
  })

  it('returns 200 with notifications array for authenticated user', async () => {
    const res = await fetch('/api/notifications', {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('only returns active notifications matching user org or role', async () => {
    const res = await fetch('/api/notifications', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    const titles = body.map((n: any) => n.title)

    // Should include notifications targeting user's org
    expect(titles).toContain('Org Notification')
    // Should include notifications targeting user's role
    expect(titles).toContain('Role Notification')
    // Should NOT include notifications for a different org
    expect(titles).not.toContain('Other Org Notification')
    // Should NOT include inactive notifications
    expect(titles).not.toContain('Inactive Notification')
  })

  it('includes read status fields in response', async () => {
    const res = await fetch('/api/notifications', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('is_read')
  })

  it('returns notifications ordered by created_at descending', async () => {
    const res = await fetch('/api/notifications', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    if (body.length >= 2) {
      const dates = body.map((n: any) => new Date(n.created_at).getTime())
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
      }
    }
  })
})
