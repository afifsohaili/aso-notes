import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

const ADMIN_EMAIL = 'afifnajib@gmail.com'

describe('admin Notifications API', () => {
  describe('authorization', () => {
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

  describe('gET /api/admin/notifications', () => {
    test('returns paginated list of notifications', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications?page=1&limit=10', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('notifications')
      expect(body).toHaveProperty('pagination')
      expect(Array.isArray(body.notifications)).toBe(true)
    })

    test('filters by type', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      await trx
        .insertInto('notifications')
        .values({
          title: 'Info Filter',
          message: 'Test',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .execute()

      const res = await server('/api/admin/notifications?type=info', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.type === 'info')).toBe(true)
    })

    test('filters by target_type', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      await trx
        .insertInto('notifications')
        .values({
          title: 'Workspace Filter',
          message: 'Test',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .execute()

      const res = await server('/api/admin/notifications?target_type=workspace', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.target_type === 'workspace')).toBe(true)
    })

    test('filters by is_active', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      await trx
        .insertInto('notifications')
        .values({
          title: 'Active Filter',
          message: 'Test',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .execute()

      const res = await server('/api/admin/notifications?is_active=true', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.notifications.every((n: any) => n.is_active === true)).toBe(true)
    })

    test('returns all notifications when limit=all', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications?limit=all', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.pagination).toBeUndefined()
    })

    test('searches by title/message', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      await trx
        .insertInto('notifications')
        .values({
          title: 'Searchable Test Notification',
          message: 'Search me',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .execute()

      const res = await server('/api/admin/notifications?search=test', {
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('pOST /api/admin/notifications', () => {
    test('creates a new notification', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })
      const testWorkspaceId = 'test-workspace-123'

      const res = await server('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Test Notification Created',
          message: 'Test message for creation',
          type: 'info',
          target_type: 'workspace',
          target_id: testWorkspaceId,
          is_active: true,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Test Notification Created')
      expect(body.message).toBe('Test message for creation')
      expect(body.type).toBe('info')
      expect(body.target_type).toBe('workspace')
      expect(body.target_id).toBe(testWorkspaceId)
      expect(body.is_active).toBe(true)
      expect(body.created_by).toBeDefined()
    })

    test('returns 400 when missing required fields', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Missing fields',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid target_type', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Invalid target',
          message: 'Test message',
          target_type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid type', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Invalid type',
          message: 'Test message',
          target_type: 'workspace',
          type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('creates notification with default values', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Default Values Test',
          message: 'Test message',
          target_type: 'role',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.type).toBe('info')
      expect(body.is_active).toBe(true)
    })
  })

  describe('pUT /api/admin/notifications/[id]', () => {
    test('updates an existing notification', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })
      const testWorkspaceId = 'test-workspace-123'

      const [created] = await trx
        .insertInto('notifications')
        .values({
          title: 'Notification to Update',
          message: 'Original message',
          type: 'info',
          target_type: 'workspace',
          target_id: testWorkspaceId,
          created_by: user.id,
          is_active: true,
        })
        .returning('id')
        .execute()

      const res = await server(`/api/admin/notifications/${created.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
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
      expect(body.id).toBe(created.id)
    })

    test('returns 404 for non-existent notification', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications/999999', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Non-existent',
        }),
      })

      expect(res.status).toBe(404)
    })

    test('returns 400 for invalid ID', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications/invalid-id', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Test',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid target_type', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const [created] = await trx
        .insertInto('notifications')
        .values({
          title: 'Invalid target type',
          message: 'Test',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .returning('id')
        .execute()

      const res = await server(`/api/admin/notifications/${created.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          target_type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid type', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const [created] = await trx
        .insertInto('notifications')
        .values({
          title: 'Invalid type',
          message: 'Test',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .returning('id')
        .execute()

      const res = await server(`/api/admin/notifications/${created.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          type: 'invalid_type',
        }),
      })

      expect(res.status).toBe(400)
    })

    test('supports partial updates', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const [created] = await trx
        .insertInto('notifications')
        .values({
          title: 'Partial Update',
          message: 'Keep me',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .returning('id')
        .execute()

      const res = await server(`/api/admin/notifications/${created.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': cookies,
        },
        body: JSON.stringify({
          title: 'Only Title Updated',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Only Title Updated')
      expect(body.message).toBeDefined()
    })
  })

  describe('dELETE /api/admin/notifications/[id]', () => {
    test('deletes an existing notification', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const [created] = await trx
        .insertInto('notifications')
        .values({
          title: 'Notification to Delete',
          message: 'Will be deleted',
          type: 'info',
          target_type: 'workspace',
          target_id: 'test-workspace',
          created_by: user.id,
          is_active: true,
        })
        .returning('id')
        .execute()

      const res = await server(`/api/admin/notifications/${created.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.notification.id).toBe(created.id)

      const remaining = await trx
        .selectFrom('notifications')
        .select('id')
        .where('id', '=', created.id)
        .execute()
      expect(remaining).toHaveLength(0)
    })

    test('returns 404 for non-existent notification', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications/999999', {
        method: 'DELETE',
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(404)
    })

    test('returns 400 for invalid ID', async ({ server }) => {
      const { cookies } = await givenVerifiedUser({ email: ADMIN_EMAIL })

      const res = await server('/api/admin/notifications/invalid-id', {
        method: 'DELETE',
        headers: { cookie: cookies },
      })

      expect(res.status).toBe(400)
    })
  })
})
