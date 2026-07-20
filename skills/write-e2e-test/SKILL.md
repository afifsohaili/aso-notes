---
name: write-e2e-test
description: Write a new e2e API test using @base/testing. Use when the user asks to add an integration test for an API endpoint or feature flow.
---

# Write an e2e API test

Default to the **in-process transactional** tier. It is the fastest and gives full isolation via per-file databases and per-test transaction rollback.

## Rules

- Use `test` from `@base/testing/test` — never plain `vitest.test` for DB/API tests.
- Use `givenVerifiedUser()` for a signed-in user with org + admin membership.
- Use `fixtures.load()` for declarative seeding inside the test transaction.
- Use `server(path, init)` to call handlers in-process. No HTTP server is spawned.
- Never write raw SQL for cleanup. Transaction rollback handles it.
- Never call `afterAll` to delete rows.
- Preserve all existing assertions when converting a spec.
- Put built-server tests (real HTTP/WebSocket) in `test/e2e-built/` and use `withBuiltServer()`.

## Template: in-process e2e spec

```ts
import { describe, expect } from 'vitest'
import { test } from '@base/testing/test'
import { givenVerifiedUser } from '@base/testing/auth'
import { fixture, ref } from '@base/testing/fixtures'

describe('GET /api/resource', () => {
  test('returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/resource')
    expect(res.status).toBe(401)
  })

  test('returns 200 with resources for authenticated user', async ({ server, fixtures }) => {
    const { user, cookies } = await givenVerifiedUser()

    const fx = await fixtures.load({
      resource: fixture('resources', {
        user_id: user.id,
        name: 'Test Resource',
      }),
    })

    const res = await server('/api/resource', {
      headers: { cookie: cookies },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Test Resource')
  })
})
```

## Template: built-server e2e spec

Use only when the test needs real HTTP, WebSocket, or SSR.

```ts
import { describe, expect, it, beforeAll } from 'vitest'
import { createFileDatabase } from '@base/testing/transaction'
import { withBuiltServer } from '@base/testing/built-server'
import type { Kysely } from 'kysely'

describe('WebSocket API', () => {
  let db: Kysely<Database>
  let baseUrl: string

  beforeAll(async () => {
    db = createFileDatabase()
    const server = await withBuiltServer()
    baseUrl = server.baseUrl
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('responds over HTTP', async () => {
    const res = await fetch(`${baseUrl}/api/healthcheck`)
    expect(res.status).toBe(200)
  })
})
```

Note: built-server tests do not share transactions with the server process. Seed via committed DB changes or HTTP endpoints.

## Queue testing

Use the `queue` fixture to assert job enqueue behavior.

```ts
test('sign-up enqueues verification email', async ({ server, queue }) => {
  queue.setMode('fake')

  await server('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })

  const jobs = queue.enqueuedJobs('email')
  expect(jobs).toHaveLength(1)
  expect(jobs[0].name).toBe('send-email')
})
```

## Do NOT do this

- Do not use `@nuxt/test-utils/e2e` with `setup({ host: process.env.TEST_HOST })` for new specs.
- Do not hand-roll sign-up/sign-in. Use `givenVerifiedUser()`.
- Do not manually `UPDATE users SET emailVerified = true`. `givenVerifiedUser()` handles it.
- Do not manually create org/membership rows. `givenVerifiedUser()` handles it.
- Do not use `pg.Pool` in specs. Use `trx` for DB reads/writes inside the test transaction.
- Do not skip `TEST_HOST` support in shared setup files; keep the `if (!process.env.TEST_HOST)` guard.
