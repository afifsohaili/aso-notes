import { dbContext } from './transaction'
import { getActiveTransaction } from './active-transaction'
import { createServerCaller } from './server-caller'
import type { Kysely } from 'kysely'
import type { Memberships, Users, Workspaces } from '@monorepo/shared'

const TEST_PASSWORD = 'TestPassword123!'

let callerPromise: Promise<ReturnType<typeof createServerCaller>> | undefined

async function getCaller(): Promise<ReturnType<typeof createServerCaller>> {
  if (!callerPromise)
    callerPromise = createServerCaller()
  return callerPromise
}

function getTrx(): Kysely<Database> {
  const trx = (dbContext.getStore()?.trx ?? getActiveTransaction()) as Kysely<Database> | undefined
  if (!trx) {
    throw new Error(
      'No active test transaction found. Use auth helpers inside a test created with the @base/testing test object.',
    )
  }
  return trx
}

function extractCookies(response: Response): string {
  const setCookies = response.headers.getSetCookie?.() ?? []
  return setCookies.map(c => c.split(';')[0]).join('; ')
}

async function callWithTrx<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as any
  const prev = g.__BASE_TESTING_TRX__
  g.__BASE_TESTING_TRX__ = getTrx()
  try {
    return await fn()
  }
  finally {
    g.__BASE_TESTING_TRX__ = prev
  }
}

/**
 * Sign in as an existing user and return the full Cookie header value.
 * This calls BetterAuth's sign-in endpoint in-process, inside the active
 * test transaction, so the session row is rolled back at teardown.
 */
export async function signInAs(userId: string): Promise<string> {
  const caller = await getCaller()
  const trx = getTrx()

  const user = await trx
    .selectFrom('users')
    .select(['email'])
    .where('id', '=', userId)
    .executeTakeFirst()

  if (!user?.email) {
    throw new Error(`User ${userId} not found in active transaction`)
  }

  const res = await callWithTrx(() =>
    caller('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
    }),
  )

  if (!res.ok) {
    throw new Error(`sign-in failed for ${user.email}: ${await res.text()}`)
  }

  return extractCookies(res)
}

/**
 * Create a verified user with a default workspace and admin membership,
 * mirroring the intent of the current manual sign-up/verify/workspace/membership flow.
 */
export async function givenVerifiedUser(
  overrides: Partial<Users> = {},
): Promise<{ user: Users, workspace: Workspaces, membership: Memberships, cookies: string }> {
  const caller = await getCaller()
  const trx = getTrx()

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = overrides.email ?? `test-${suffix}@example.com`
  const name = overrides.name ?? `Test User ${suffix}`

  const signUpRes = await callWithTrx(() =>
    caller('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
    }),
  )

  if (!signUpRes.ok) {
    throw new Error(`sign-up failed: ${await signUpRes.text()}`)
  }

  const body = (await signUpRes.json()) as { user?: { id: string } }
  const userId = body.user?.id
  if (!userId) {
    throw new Error(`sign-up response missing user.id: ${JSON.stringify(body)}`)
  }

  // BetterAuth skips the after-sign-up hook when email verification is required,
  // so we verify the email and create the workspace/membership manually.
  await trx
    .updateTable('users')
    .set({ emailVerified: true })
    .where('id', '=', userId)
    .execute()

  const [workspace] = await trx
    .insertInto('workspaces')
    .values({ name: `${email}'s Workspace` })
    .returning(['id', 'name', 'created_at', 'updated_at'])
    .execute()

  await trx
    .insertInto('memberships')
    .values({ user_id: userId, workspace_id: workspace.id, role: 'admin' })
    .execute()

  const cookies = await signInAs(userId)

  const user = await trx
    .selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()

  const membership = await trx
    .selectFrom('memberships')
    .selectAll()
    .where('user_id', '=', userId)
    .where('workspace_id', '=', workspace.id)
    .executeTakeFirstOrThrow()

  return { user, workspace, membership, cookies }
}
