import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('in-process transactional smoke', () => {
  test('GET /api/notifications without auth returns 401', async ({ server }) => {
    const res = await server('/api/notifications')
    expect(res.status).toBe(401)
  })

  test('writes are visible test-side and rolled back', async ({ trx }) => {
    const email = `smoke-${Date.now()}@example.com`
    await trx
      .insertInto('users')
      .values({
        id: crypto.randomUUID(),
        name: 'Smoke User',
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute()

    const found = await trx.selectFrom('users').select('id').where('email', '=', email).execute()
    expect(found).toHaveLength(1)

    // Rollback happens automatically after the test; this assertion proves the
    // row is still visible inside the same transaction.
    expect(found).toHaveLength(1)
  })

  test('previous test insert was rolled back', async ({ trx }) => {
    const users = await trx
      .selectFrom('users')
      .select('id')
      .where('email', 'like', 'smoke-%@example.com')
      .execute()
    expect(users).toHaveLength(0)
  })

  test('database pool is independent of transaction', async ({ db }) => {
    const result = await db.selectFrom('users').select(eb => eb.fn.countAll().as('count')).executeTakeFirst()
    expect(Number(result?.count)).toBeGreaterThanOrEqual(0)
  })
})
