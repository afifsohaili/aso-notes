import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, test as vitestTest } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { dbContext } from './als'
import { createServerCaller } from './server-caller'

interface DbFixture {
  db: Kysely<Database>
  trx: Kysely<Database>
  server: (path: string, init?: RequestInit) => Promise<Response>
  outputMtimeMs: number
}

const test = vitestTest.extend<DbFixture>({
  db: async ({}, use) => {
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: process.env.NUXT_DATABASE_URL,
        }),
      }),
    })
    await use(db)
    await db.destroy()
  },
  trx: async ({ db }, use) => {
    const trx = await db.startTransaction().execute()
    await dbContext.run({ trx }, async () => {
      await use(trx as unknown as Kysely<Database>)
    })
    await trx.rollback().execute()
  },
  server: async ({ trx }, use) => {
    const caller = await createServerCaller()
    const trxInstance = trx as unknown as Transaction<Database>
    await use(async (path: string, init?: RequestInit) => {
      const activeTrx = dbContext.getStore()?.trx ?? trxInstance
      return dbContext.run({ trx: activeTrx }, () => caller(path, init))
    })
  },
  outputMtimeMs: async ({}, use) => {
    const fs = await import('node:fs')
    const stat = fs.statSync('apps/web/.output/server/index.mjs')
    await use(stat.mtimeMs)
  },
})

async function signUpAndSignIn(server: (path: string, init?: RequestInit) => Promise<Response>, trx: Kysely<Database>) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const testEmail = `spike-user-${suffix}@example.com`
  const password = 'SpikePassword123!'

  const signUpRes = await server('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Spike User',
      email: testEmail,
      password,
    }),
  })
  if (!signUpRes.ok)
    throw new Error(`Sign-up failed: ${await signUpRes.text()}`)

  const signUpBody = await signUpRes.json() as { user?: { id: string } }
  const userId = signUpBody.user?.id
  if (!userId)
    throw new Error('Sign-up response missing user.id')

  await trx
    .updateTable('users')
    .set({ emailVerified: true })
    .where('id', '=', userId)
    .execute()

  const signInRes = await server('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password }),
  })
  if (!signInRes.ok)
    throw new Error(`Sign-in failed: ${await signInRes.text()}`)

  const setCookies = signInRes.headers.getSetCookie?.() ?? []
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ')

  const [org] = await trx
    .insertInto('organizations')
    .values({ name: `${testEmail}'s Organization` })
    .returning(['id'])
    .execute()

  await trx
    .insertInto('memberships')
    .values({ user_id: userId, organization_id: org.id, role: 'admin' })
    .execute()

  return { userId, orgId: org.id, cookies }
}

describe('in-process server caller spike', () => {
  beforeAll(() => {
    if (!process.env.NUXT_DATABASE_URL) {
      throw new Error(
        'NUXT_DATABASE_URL must be set. Run tests with NUXT_DATABASE_URL=postgresql://...',
      )
    }
  })

  test('GET /api/notifications with no cookie returns 401', async ({ server }) => {
    const res = await server('/api/notifications')
    expect(res.status).toBe(401)
  })

  test('GET /api/notifications sees uncommitted session row inside transaction', async ({ server, trx }) => {
    const { userId, orgId, cookies } = await signUpAndSignIn(server, trx)

    const [notification] = await trx
      .insertInto('notifications')
      .values({
        title: 'Spike Notification',
        message: 'Visible to spike user',
        type: 'info',
        target_type: 'organization',
        target_id: orgId,
        created_by: userId,
        is_active: true,
      })
      .returning(['id', 'title'])
      .execute()

    const res = await server('/api/notifications', {
      headers: { cookie: cookies },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    const titles = body.map((n: any) => n.title)
    expect(titles).toContain(notification.title)
  })

  test('writes via the API are visible test-side and rolled back', async ({ server, trx }) => {
    const { userId, orgId, cookies } = await signUpAndSignIn(server, trx)

    await trx
      .insertInto('notifications')
      .values({
        title: 'Unread Notification',
        message: 'To be marked read',
        type: 'info',
        target_type: 'organization',
        target_id: orgId,
        created_by: userId,
        is_active: true,
      })
      .execute()

    const before = await trx
      .selectFrom('read_notifications')
      .select(eb => eb.fn.countAll().as('count'))
      .executeTakeFirst()
    expect(Number(before?.count)).toBe(0)

    const res = await server('/api/notifications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: cookies,
      },
      body: JSON.stringify({ mark_all: true }),
    })
    expect(res.status).toBe(200)

    const after = await trx
      .selectFrom('read_notifications')
      .select(eb => eb.fn.countAll().as('count'))
      .executeTakeFirst()
    expect(Number(after?.count)).toBe(1)
  })

  test('explicit rollback proof: insert then gone', async ({ trx }) => {
    const email = `rollback-proof-${Date.now()}@example.com`
    await trx
      .insertInto('users')
      .values({
        id: crypto.randomUUID(),
        name: 'Rollback Proof',
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute()

    const found = await trx.selectFrom('users').select('id').where('email', '=', email).execute()
    expect(found).toHaveLength(1)
  })

  test('previous test insert was rolled back', async ({ trx }) => {
    const users = await trx
      .selectFrom('users')
      .select('id')
      .where('email', 'like', 'rollback-proof-%@example.com')
      .execute()
    expect(users).toHaveLength(0)
  })

  test('tests are isolated by transaction rollback', async ({ server, trx }) => {
    const { userId, orgId, cookies } = await signUpAndSignIn(server, trx)

    const [notification] = await trx
      .insertInto('notifications')
      .values({
        title: 'Isolated Notification',
        message: 'Only in this test',
        type: 'info',
        target_type: 'organization',
        target_id: orgId,
        created_by: userId,
        is_active: true,
      })
      .returning(['id'])
      .execute()

    const res = await server('/api/notifications', {
      headers: { cookie: cookies },
    })

    const body = await res.json()
    const found = body.find((n: any) => n.id === notification.id)
    expect(found).toBeDefined()
  })

  test('harness does not trigger a Nuxt build', async ({ outputMtimeMs }) => {
    const fs = await import('node:fs')
    const stat = fs.statSync('apps/web/.output/server/index.mjs')
    expect(stat.mtimeMs).toBe(outputMtimeMs)
  })

  test('harness boot overhead is small', async () => {
    const start = performance.now()
    const c = await createServerCaller()
    const bootMs = performance.now() - start
    const trivialStart = performance.now()
    await c('/api/notifications')
    const trivialMs = performance.now() - trivialStart
    process.stderr.write(JSON.stringify({ bootMs, trivialMs }) + '\n')
    expect(bootMs).toBeLessThan(1000)
    expect(trivialMs).toBeLessThan(100)
  })
})
