import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('gET /api/notifications', () => {
  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/notifications')
    expect(res.status).toBe(401)
  })

  test('returns 200 with notifications array for authenticated user', async ({ server, trx }) => {
    const { user, workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('notifications')
      .values({
        title: 'Workspace Notification',
        message: 'Visible to workspace members',
        type: 'info',
        target_type: 'workspace',
        target_id: workspace.id,
        created_by: user.id,
        is_active: true,
      })
      .execute()

    const res = await server('/api/notifications', {
      headers: { cookie: cookies },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('only returns active notifications matching user workspace or role', async ({ server, trx }) => {
    const { user, workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('notifications')
      .values([
        {
          title: 'Workspace Notification',
          message: 'Visible to workspace members',
          type: 'info',
          target_type: 'workspace',
          target_id: workspace.id,
          created_by: user.id,
          is_active: true,
        },
        {
          title: 'Role Notification',
          message: 'Visible to admins',
          type: 'warning',
          target_type: 'role',
          target_id: 'admin',
          created_by: user.id,
          is_active: true,
        },
        {
          title: 'Other Workspace Notification',
          message: 'Should not be visible',
          type: 'info',
          target_type: 'workspace',
          target_id: 'non-existent-workspace',
          created_by: user.id,
          is_active: true,
        },
        {
          title: 'Inactive Notification',
          message: 'Should not be visible',
          type: 'info',
          target_type: 'workspace',
          target_id: workspace.id,
          created_by: user.id,
          is_active: false,
        },
      ])
      .execute()

    const res = await server('/api/notifications', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    const titles = body.map((n: any) => n.title)

    expect(titles).toContain('Workspace Notification')
    expect(titles).toContain('Role Notification')
    expect(titles).not.toContain('Other Workspace Notification')
    expect(titles).not.toContain('Inactive Notification')
  })

  test('includes read status fields in response', async ({ server, trx }) => {
    const { user, workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('notifications')
      .values({
        title: 'Read Status Notification',
        message: 'Has read status',
        type: 'info',
        target_type: 'workspace',
        target_id: workspace.id,
        created_by: user.id,
        is_active: true,
      })
      .execute()

    const res = await server('/api/notifications', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('is_read')
  })

  test('returns notifications ordered by created_at descending', async ({ server, trx }) => {
    const { user, workspace, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('notifications')
      .values([
        {
          title: 'Older Notification',
          message: 'Older',
          type: 'info',
          target_type: 'workspace',
          target_id: workspace.id,
          created_by: user.id,
          is_active: true,
        },
        {
          title: 'Newer Notification',
          message: 'Newer',
          type: 'info',
          target_type: 'workspace',
          target_id: workspace.id,
          created_by: user.id,
          is_active: true,
        },
      ])
      .execute()

    const res = await server('/api/notifications', {
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
