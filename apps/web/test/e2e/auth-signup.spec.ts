import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('sign-up creates a default workspace', () => {
  test('a new user gets a workspace and admin membership', async ({ server, trx }) => {
    const email = `m9-workspace-${Date.now()}@example.com`

    const res = await server('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'TestPass123!',
        name: 'M9 Workspace Tester',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { user?: { id: string } }
    const userId = body.user?.id
    expect(userId).toBeTruthy()

    const membership = await trx
      .selectFrom('memberships')
      .innerJoin('workspaces', 'workspaces.id', 'memberships.workspace_id')
      .select(['memberships.role', 'workspaces.name'])
      .where('memberships.user_id', '=', userId!)
      .executeTakeFirstOrThrow()

    expect(membership.role).toBe('admin')
    expect(membership.name).toContain('M9 Workspace Tester')
  })
})
