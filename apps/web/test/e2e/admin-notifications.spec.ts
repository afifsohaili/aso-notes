import { readFileSync } from 'node:fs'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { Pool } from 'pg'
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

describe('admin Notifications API', async () => {
  // Setup Nuxt test context (uses TEST_HOST if provided, otherwise starts new server)
  await setup({
    host: process.env.TEST_HOST,
  })
  const db = new Pool({ connectionString: process.env.DATABASE_URL })

  // Test users
  let adminCookies: string
  let regularUserCookies: string
  const adminEmail = 'afifnajib@gmail.com'
  const regularEmail = `test-regular-${Date.now()}@example.com`

  // Test data
  let createdNotificationId: number
  const testOrgId = 'test-org-123'

  beforeAll(async () => {
    const testHost = process.env.TEST_HOST || 'http://localhost:3000'

    // 1. Create admin user (the hardcoded admin email) - may already exist
    const adminSignupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': testHost,
      },
      body: JSON.stringify({
        email: adminEmail,
        password: 'AdminPass123!',
        name: 'Admin User',
      }),
    })

    const adminSignupBody = await adminSignupRes.json()
    if (!adminSignupRes.ok && !adminSignupBody?.code?.includes('ALREADY_EXISTS')) {
      throw new Error(`Admin signup failed: ${JSON.stringify(adminSignupBody)}`)
    }

    // Verify admin email
    await db.query('UPDATE users SET "emailVerified" = true WHERE email = $1', [adminEmail])

    // Login as admin
    const adminLoginRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': testHost,
      },
      body: JSON.stringify({
        email: adminEmail,
        password: 'AdminPass123!',
      }),
    })

    if (!adminLoginRes.ok) {
      throw new Error(`Admin login failed: ${await adminLoginRes.text()}`)
    }

    const adminSetCookies = adminLoginRes.headers.getSetCookie?.() ?? []
    adminCookies = adminSetCookies.map(c => c.split(';')[0]).join('; ')

    // 2. Create regular user
    const regularSignupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': testHost,
      },
      body: JSON.stringify({
        email: regularEmail,
        password: 'RegularPass123!',
        name: 'Regular User',
      }),
    })

    if (!regularSignupRes.ok && regularSignupRes.status !== 409) {
      throw new Error(`Regular user signup failed: ${await regularSignupRes.text()}`)
    }

    // Verify regular email
    await db.query('UPDATE users SET "emailVerified" = true WHERE email = $1', [regularEmail])

    // Login as regular user
    const regularLoginRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': testHost,
      },
      body: JSON.stringify({
        email: regularEmail,
        password: 'RegularPass123!',
      }),
    })

    if (!regularLoginRes.ok) {
      throw new Error(`Regular user login failed: ${await regularLoginRes.text()}`)
    }

    const regularSetCookies = regularLoginRes.headers.getSetCookie?.() ?? []
    regularUserCookies = regularSetCookies.map(c => c.split(';')[0]).join('; ')
  })

  afterAll(async () => {
    // Cleanup in correct order to avoid FK violations
    // 1. Delete test notifications
    await db.query('DELETE FROM notifications WHERE title LIKE \'Test Notification%\' OR message LIKE \'Test message%\' OR title LIKE \'Notification to %\'')

    // 2. Delete sessions for test users
    await db.query(`
      DELETE FROM sessions 
      WHERE "userId" IN (
        SELECT id FROM users WHERE email IN ($1, $2)
      )
    `, [regularEmail, adminEmail])

    // 3. Delete accounts for test users
    await db.query(`
      DELETE FROM accounts 
      WHERE "userId" IN (
        SELECT id FROM users WHERE email IN ($1, $2)
      )
    `, [regularEmail, adminEmail])

    // 4. Delete test users
    await db.query('DELETE FROM users WHERE email IN ($1, $2)', [regularEmail, adminEmail])
    await db.end()
  })

  describe('authorization', () => {
    it('returns 401 when accessing admin routes without auth', async () => {
      const res = await fetch('/api/admin/notifications')
      expect(res.status).toBe(401)
    })

    it('returns 403 when non-admin user accesses admin routes', async () => {
      const res = await fetch('/api/admin/notifications', {
        headers: { Cookie: regularUserCookies },
      })
      expect(res.status).toBe(403)
    })
  })

  describe('gET /api/admin/notifications', () => {
    it('returns paginated list of notifications', async () => {
      const res = await fetch('/api/admin/notifications?page=1&limit=10', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('notifications')
      expect(body).toHaveProperty('pagination')
      expect(Array.isArray(body.notifications)).toBe(true)
    })

    it('filters by type', async () => {
      const res = await fetch('/api/admin/notifications?type=info', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.type === 'info')).toBe(true)
    })

    it('filters by target_type', async () => {
      const res = await fetch('/api/admin/notifications?target_type=organization', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.target_type === 'organization')).toBe(true)
    })

    it('filters by is_active', async () => {
      const res = await fetch('/api/admin/notifications?is_active=true', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.is_active === true)).toBe(true)
    })

    it('returns all notifications when limit=all', async () => {
      const res = await fetch('/api/admin/notifications?limit=all', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.pagination).toBeUndefined()
    })

    it('searches by title/message', async () => {
      const res = await fetch('/api/admin/notifications?search=test', {
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      // Just verify it doesn't error - search behavior depends on DB data
    })
  })

  describe('pOST /api/admin/notifications', () => {
    it('creates a new notification', async () => {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Test Notification Created',
          message: 'Test message for creation',
          type: 'info',
          target_type: 'organization',
          target_id: testOrgId,
          is_active: true,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Test Notification Created')
      expect(body.message).toBe('Test message for creation')
      expect(body.type).toBe('info')
      expect(body.target_type).toBe('organization')
      expect(body.target_id).toBe(testOrgId)
      expect(body.is_active).toBe(true)
      expect(body.created_by).toBeDefined()

      createdNotificationId = body.id
    })

    it('returns 400 when missing required fields', async () => {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Missing fields',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid target_type', async () => {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Invalid target',
          message: 'Test message',
          target_type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid type', async () => {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Invalid type',
          message: 'Test message',
          target_type: 'organization',
          type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('creates notification with default values', async () => {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Default Values Test',
          message: 'Test message',
          target_type: 'role',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.type).toBe('info') // Default type
      expect(body.is_active).toBe(true) // Default is_active
    })
  })

  describe('pUT /api/admin/notifications/[id]', () => {
    it('updates an existing notification', async () => {
      // First create a notification to update
      const createRes = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Notification to Update',
          message: 'Original message',
          target_type: 'organization',
          target_id: testOrgId,
          is_active: true,
        }),
      })

      const created = await createRes.json()
      const notificationId = created.id

      // Now update it
      const res = await fetch(`/api/admin/notifications/${notificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Updated Title',
          message: 'Updated message',
          is_active: false,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Updated Title')
      expect(body.message).toBe('Updated message')
      expect(body.is_active).toBe(false)
      expect(body.id).toBe(notificationId)
    })

    it('returns 404 for non-existent notification', async () => {
      const res = await fetch('/api/admin/notifications/999999', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Non-existent',
        }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid ID', async () => {
      const res = await fetch('/api/admin/notifications/invalid-id', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Test',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid target_type', async () => {
      const res = await fetch(`/api/admin/notifications/${createdNotificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          target_type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid type', async () => {
      const res = await fetch(`/api/admin/notifications/${createdNotificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    it('supports partial updates', async () => {
      const res = await fetch(`/api/admin/notifications/${createdNotificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Only Title Updated',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Only Title Updated')
      expect(body.message).toBeDefined() // Other fields unchanged
    })
  })

  describe('dELETE /api/admin/notifications/[id]', () => {
    it('deletes an existing notification', async () => {
      // First create a notification to delete
      const createRes = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': adminCookies,
        },
        body: JSON.stringify({
          title: 'Notification to Delete',
          message: 'Will be deleted',
          target_type: 'organization',
        }),
      })

      const created = await createRes.json()
      const notificationId = created.id

      // Delete it
      const res = await fetch(`/api/admin/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.notification.id).toBe(notificationId)

      // Verify it's actually deleted
      const getRes = await fetch(`/api/admin/notifications/${notificationId}`, {
        headers: { Cookie: adminCookies },
      })
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for non-existent notification', async () => {
      const res = await fetch('/api/admin/notifications/999999', {
        method: 'DELETE',
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid ID', async () => {
      const res = await fetch('/api/admin/notifications/invalid-id', {
        method: 'DELETE',
        headers: { Cookie: adminCookies },
      })

      expect(res.status).toBe(400)
    })
  })
})
