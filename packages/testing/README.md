# @base/testing

Rails-inspired testing foundation for base-nuxt-app.

## Quickstart

```bash
# Run the fast in-process e2e suite
pnpm --filter web vitest run --project e2e

# Run the full suite (unit + e2e + built-server + component tests)
pnpm --filter web test

# Dump the current DB schema to apps/web/db/schema.sql
pnpm --filter web db:schema:dump
```

## Capabilities

1. **Per-file database provisioning** — one template DB per run, cloned per test file.
2. **Transactional tests** — every test runs inside a single Postgres transaction that is rolled back at teardown.
3. **In-process server calls** — the default tier calls Nitro/h3 handlers directly in the test process. No Nuxt build, no socket, no spawned server.
4. **Built-server e2e** — one `nuxt build` per run, then per-file servers spawn from the prebuilt output.
5. **Typed fixtures, auth helpers, and queue testing** — declarative fixtures, `signInAs`/`givenVerifiedUser`, and fake/inline/real queue modes.

## Test tiers

### 1. In-process transactional (default)

Use this for API behavior tests. It is the fastest tier and has full transaction isolation.

```ts
import { test } from '@base/testing/test'
import { givenVerifiedUser } from '@base/testing/auth'

test('GET /api/notifications returns 401', async ({ server }) => {
  const res = await server('/api/notifications')
  expect(res.status).toBe(401)
})

test('user sees own notifications', async ({ server, trx }) => {
  const { user, org, cookies } = await givenVerifiedUser()

  await trx.insertInto('notifications').values({
    title: 'Hello',
    message: 'World',
    type: 'info',
    target_type: 'organization',
    target_id: org.id,
    created_by: user.id,
    is_active: true,
  }).execute()

  const res = await server('/api/notifications', { headers: { cookie: cookies } })
  expect(res.status).toBe(200)
})
```

Every test runs inside a transaction. Changes made by the API and by the test are visible to both, and rolled back after the test.

### 2. Built-server (real HTTP)

Use this for tests that need real HTTP, WebSocket, or SSR behavior. There is exactly one `nuxt build` per run; each test file spawns one `node .output/server/index.mjs` on an ephemeral port and kills it in teardown.

```ts
import { withBuiltServer } from '@base/testing/built-server'

const { baseUrl } = await withBuiltServer()
const res = await fetch(`${baseUrl}/api/healthcheck`)
```

This tier does **not** share transactions with the server process. Use committed DB changes (via `createFileDatabase()` in the test file) or HTTP endpoints for setup.

### 3. TEST_HOST (dev loop)

Run tests against a manually started dev server. This trades isolation for speed of feedback and is useful when iterating locally.

```bash
pnpm dev --port 3001
TEST_HOST=http://localhost:3001 pnpm vitest run test/e2e/healthcheck.get.spec.ts
```

All specs support `TEST_HOST`. When set, the test harness skips template/per-file DB creation so the test process and dev server share the dev DB.

## Queue testing modes

`@base/jobs` exposes `ApplicationJob` and an adapter registry. `@base/testing` provides three adapters:

- **fake** (default): records jobs in memory. Assert with `queue.enqueuedJobs()`.
- **inline**: performs the job immediately in the current async context. DB side-effects roll back with the test transaction.
- **real**: enqueues to BullMQ/Redis.

```ts
import { test } from '@base/testing/test'

test('sign-up enqueues verification email', async ({ queue }) => {
  queue.setMode('fake')
  // ... trigger sign-up
  const jobs = queue.enqueuedJobs('email')
  expect(jobs).toHaveLength(1)
})

test('inline job updates the DB', async ({ queue, trx }) => {
  queue.setMode('inline')
  // enqueueing performs the job immediately inside the test transaction
})
```

## Fixtures

Typed fixture loader backed by `@monorepo/shared` DB types.

```ts
import { fixture, ref } from '@base/testing/fixtures'

const fx = await fixtures.load({
  org: fixture('organizations', { name: 'Acme' }),
  user: fixture('users', { name: 'Alice' }),
  membership: fixture('memberships', {
    user_id: ref('user'),
    organization_id: ref('org'),
    role: 'admin',
  }),
})
```

Fixture refs are resolved in dependency order (topological sort). Cycles throw a clear error.

## Auth helpers

```ts
import { givenVerifiedUser, signInAs } from '@base/testing/auth'

// Creates a verified user + default org + admin membership, signs them in.
const { user, org, membership, cookies } = await givenVerifiedUser()

// Sign in as an existing user and get the Cookie header value.
const cookies = await signInAs(userId)
```

## Required env vars

The harness reads from `apps/web/.env.local` (via dotenv). Required for e2e:

- `NUXT_DATABASE_URL` or `DATABASE_URL` — base Postgres connection. The template DB and per-file DBs are derived from this URL.
- `NUXT_REDIS_URL` or `REDIS_URL` — required when queue mode is `real` or when hitting endpoints that enqueue jobs.
- `NUXT_BETTER_AUTH_SECRET` — any non-empty string for tests.

## DB schema dump

`pnpm --filter web db:schema:dump` creates a temporary database, applies all migrations, dumps the schema to `apps/web/db/schema.sql`, and drops the temporary database. This guarantees `schema.sql` always matches the current migration set, independent of the dev DB state.

## Troubleshooting

- **`pnpm db:migrate` fails with "previously executed migration X is missing"**: your shell has stale `NUXT_DATABASE_URL`/`DATABASE_URL` pointing to a different database, or the target DB's `kysely_migration` table contains entries not in the repo. Unset the env vars or fix the migration history. The test harness does not depend on the dev DB; it uses `db/schema.sql`.
- **Wrong schema after `db:schema:dump`**: the script now always rebuilds from migrations, so this should not happen. If it does, ensure `apps/web/migrations` matches the intended schema.

## Performance model

- In-process tests: no build, no server spawn. ~1s per file including DB clone.
- Built-server tests: one build per run (cached by content hash over `apps/web/server`, `apps/web/utils`, `nuxt.config.ts`, `package.json`, `pnpm-lock.yaml`). Per-file server spawn is ~1s.
- Forks are capped at 2 to avoid resource exhaustion from parallel test processes.

## Built-server WebSocket broadcast limitation

WebSocket connection and auth work against the built server, but `crossws` `peer.send()` does not currently deliver broadcast messages to the `ws` client in this Nitro/node-server preset. Broadcast assertions are skipped in `test/e2e-built/todos.ws.spec.ts`. Those flows are still covered by the dev-server loop via `TEST_HOST`.
