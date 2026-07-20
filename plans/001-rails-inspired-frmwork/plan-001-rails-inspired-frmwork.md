# Plan 001–003 — Rails-Inspired Batteries for base-nuxt-app

> Swarm-ready implementation plan. This document is the single source of truth for the agent swarm. Read it in full before touching code. Cross-reference with `spike/REPORT.md` and the spike code under `spike/` — the spike findings are binding.
>
> Three phases:
> - **Phase 1 (Plan 001):** Testing foundation — `@base/testing` (WS1a–WS5).
> - **Phase 2 (Plan 002):** Auth module + production queue story — `@base/auth`, `@base/jobs` (WS6–WS7).
> - **Phase 3 (Plan 003):** Developer-experience batteries — mailer, console, bin scripts, security, logging, remaining skills (WS8–WS10).

---

## 1. Goal

Build the Rails-style batteries for base-nuxt-app, in three phases.

**Phase 1 — Testing foundation (`packages/testing`, name `@base/testing`):** the test suite follows the **Rails parallel testing model**:

- One template database per run, cloned from `db/schema.sql`.
- One isolated database per test file.
- Each test runs inside a single Postgres transaction that is rolled back at teardown.
- The default test tier calls Nitro/h3 handlers **in-process** with no `nuxt build` and no spawned server.
- A secondary tier spawns a real HTTP server from a **prebuilt** Nitro output (one build per run).
- A tertiary dev loop keeps the existing `TEST_HOST` mode working against a running dev server.

Success is proven by rewriting `apps/web/test/e2e/notifications.get.spec.ts` and `apps/web/test/e2e/admin-auth.spec.ts` on the new harness. Both must pass with zero manual SQL and zero cleanup code in the spec bodies.

**Phase 2 — Auth module + production queue story (`packages/auth` = `@base/auth`, `packages/jobs` = `@base/jobs`):**

- better-auth wrapped as a Nuxt module with user-friendly config in `nuxt.config.ts` (strategies, email verification policy, organizations, hooks, routeRules-based protection), plus a Pundit-style `can()` authorization helper.
- `ApplicationJob` convention for production code, worker bootstrap conventions (in-process dev / separate process prod), repeatable (cron) jobs, and a Sidekiq-UI-equivalent dashboard mounted in the app, admin-protected.

**Phase 3 — Developer-experience batteries:**

- Mailer: template convention, dev-only `/dev/mailbox` preview route, email test assertions.
- `pnpm console` — a REPL with db/auth/queues preloaded (the `rails console` equivalent).
- `bin/setup` and `bin/dev` — one-command project setup and one-command full-stack dev (web + worker + dashboard).
- Security defaults (evaluate/install `nuxt-security`), request-ID + structured logging middleware, thin cache facade.
- Remaining agent skills: `add-migration`, `add-authed-route`.

---

## 2. Context — verified repo facts (treat as ground truth)

### 2.1 Monorepo layout

- `apps/web` — Nuxt 4.4 app. Server lives in `apps/web/server`. Runtime config in `apps/web/nuxt.config.ts`.
- `packages/shared` — Shared types. `packages/shared/types.d.ts` is the kysely-codegen output (`@monorepo/shared`).
- `packages/components` — Vue components.
- `packages/testing` — **NEW workspace package** (Phase 1). Name: `@base/testing`.
- `packages/jobs` — **NEW workspace package** (Phase 2, skeleton created in Phase 1 WS0). Name: `@base/jobs`.
- `packages/auth` — **NEW workspace package** (Phase 2). Name: `@base/auth`.
- `packages/mail` — **NEW workspace package** (Phase 3). Name: `@base/mail`.

### 2.2 Stack

- **DB:** Kysely 0.28 + `pg`. Accessor: `useDatabase({ databaseUrl })` in `apps/web/utils/db.ts`.
- **Auth:** better-auth 1.6, email+password, `requireEmailVerification: true`. Instance created by `useAuth(env)` in `apps/web/utils/auth.ts`. Sign-up hook creates `organizations` + `memberships` rows manually (better-auth's organization plugin is NOT currently used).
- **Queues:** BullMQ 5 + ioredis. Helpers: `apps/web/server/utils/queue.ts` (`useQueue`) and `apps/web/server/utils/worker.ts` (`useWorker`). Both require `NUXT_REDIS_URL`. Email sending goes through an `email` queue (`apps/web/server/lib/email.ts`) with a worker started by the `email-worker` Nitro plugin.
- **Tests:** Vitest 4. Current config: `apps/web/vitest.config.ts` with three projects: `unit`, `e2e`, `nuxt`.

### 2.3 Existing test pain

`apps/web/test/e2e/notifications.get.spec.ts` and `apps/web/test/e2e/admin-auth.spec.ts` currently:

- Hand-roll sign-up via better-auth endpoints.
- Manually run `UPDATE users SET "emailVerified" = true` via raw SQL.
- Manually insert org/membership rows via raw SQL.
- Scrape signed cookies from sign-in responses.
- Seed and clean up via raw SQL in `beforeAll`/`afterAll`.
- Spawn a full Nuxt server per file (or rely on `TEST_HOST`).

There is no transactional isolation because the server runs in a separate process from the test.

### 2.4 Important: the two sanctioned app-code patches are ALREADY in `main`

The spike required two small changes to app code. Inspect the current `main` branch — **both are already applied**. Do not reapply them; verify and preserve them:

**Patch 1 — `apps/web/utils/db.ts` (ALS-aware accessor):**

```ts
import type { Transaction } from 'kysely'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

export interface DbContext {
  trx: Transaction<Database>
}

export const dbContext = new AsyncLocalStorage<DbContext>()

export function useDatabase(env: { databaseUrl: string }) {
  const activeTrx = dbContext.getStore()?.trx
  if (activeTrx)
    return activeTrx

  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
  })

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}
```

**Patch 2 — `apps/web/utils/auth.ts` (auth queries routed through `useDatabase`):**

```ts
const db = useDatabase(env)
const auth = betterAuth({
  database: {
    db,
    type: 'postgres',
  },
  // ... rest unchanged
})
```

> If either patch has been reverted or diverges from the above, stop and escalate to the orchestrator. These are load-bearing for the in-process transactional tier.

---

## 3. Proven prior art — port from `afifsohaili/cntctus`

The sibling repo `cntctus` (same owner, same stack) has a working test-DB provisioning system. You are likely running on the owner's machine. Check for local checkouts **first**:

```bash
ls ~/Projects/cntctus
```

If present, read and port these files into `@base/testing`:

- `apps/web/scripts/dump-schema.ts` — runs `pg_dump --schema-only --no-owner --no-privileges --clean --if-exists` and writes `apps/web/db/schema.sql`.
- `apps/web/test/helpers/test-database.ts` — admin client on the `postgres` DB; `createTemplateDatabase()`, `seedTemplateDatabase()`, `createTestDatabase()`, `dropTestDatabase()`.
- `apps/web/test/global-setup.ts` — creates the template DB once per run.
- `apps/web/test/e2e/setup.ts` — per-file setup: creates the file's own DB from the template and sets `process.env.NUXT_DATABASE_URL`/`DATABASE_URL` **before** the test file imports anything.
- `apps/web/vitest.config.ts` — `pool: 'forks'` for the e2e project. `cntctus` caps `maxForks: 1`; we are removing that cap (target: 4).

If `cntctus` is not checked out locally, read the files via the GitHub API or web interface. Fall back to implementing from the descriptions below only if both local and remote access fail.

### 3.1 Gaps in cntctus you must fix while porting

1. **Template creation race:** two concurrent vitest runs on one machine can corrupt the template. Wrap template create/recreate in a Postgres advisory lock (`pg_advisory_lock(hashtext($1))`).
2. **Isolation is per-file, not per-test:** cntctus specs still clean with `DELETE`s. WS1b fixes this with per-test transactions.
3. **Full Nuxt build per file:** WS1c fixes this with a build-once model.
4. **Hardcoded template name:** derive the template name from app name + a run identifier; do not use a literal `test_template`.

---

## 4. Spike findings — binding for Workstream 1b

Branch `spike/in-process-testing` already proved the core hypothesis. Read these files before writing any WS1b code:

- `spike/REPORT.md`
- `spike/vitest.config.ts`
- `spike/server-caller.ts`
- `spike/runtime-config.ts`
- `spike/spike.spec.ts`
- `spike/als.ts`

### 4.1 Verdict

**Path A works.** We can boot the h3 app in-process, route requests through real middleware and API handlers, and have every DB query (test code + server code + better-auth) execute inside a single Postgres transaction rolled back at the end of each test. No `nuxt build`, no socket, no spawned server is required for the default tier.

### 4.2 Key measurements (local M-series MacBook)

| Metric | Value |
| --- | --- |
| Harness boot (`createServerCaller()`) | ~49 ms |
| Trivial authenticated request overhead | ~13 ms |
| Full `spike/spike.spec.ts` (8 tests) | ~1.7 s |
| Existing `test/e2e/healthcheck.get.spec.ts` (one spawned server + build) | ~41–47 s |

### 4.3 Working auto-import shim (`spike/vitest.config.ts`)

```ts
import unimport from 'unimport/unplugin'

unimport.vite({
  presets: [
    { from: 'h3', imports: Object.keys(h3) },
    { from: runtimeConfigPath, imports: ['useRuntimeConfig'] },
  ],
  dirs: [
    resolve(appRoot, 'utils'),
    resolve(appRoot, 'server/utils'),
    resolve(appRoot, 'server/lib'),
  ],
  dts: false,
})
```

Key aliases:

```ts
resolve: {
  alias: {
    '~~': appRoot,
    '~': appRoot,
    '#server': resolve(appRoot, 'server'),
    '@monorepo/shared': resolve(__dirname, '../packages/shared/types.d.ts'),
  },
}
```

### 4.4 Runtime-config shim (`spike/runtime-config.ts`)

`useRuntimeConfig` is **not** an h3 export; it is a Nitro/Nuxt auto-import. The harness must provide its own shim:

```ts
import type { H3Event } from 'h3'

const runtimeConfig = {
  databaseUrl: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || '',
}

export function useRuntimeConfig(event?: H3Event) {
  return (event as any)?.context?.runtimeConfig || runtimeConfig
}
```

### 4.5 Server-caller assembly (`spike/server-caller.ts`)

- `createApp()` from h3.
- Inject `event.context.runtimeConfig` in a first middleware if missing.
- Register `apps/web/server/middleware/*.ts` in filename order (alphabetical). Note: auth middleware is `apps/web/server/middleware/00-auth.ts`.
- Build a file-based router for `apps/web/server/api/**/*.ts`.
  - Convert `[id].get.ts` → `:id` method GET.
  - Convert `[...auth].ts` → `**` catch-all.
  - Convert `index.get.ts` → `GET /api/foo`.
  - Register specific routes before catch-alls.
- Exclude `apps/web/server/api/_sitemap-urls.ts` — it depends on `#content/manifest` which only exists after a real Nuxt build.
- Return a `caller(path, init) => Promise<Response>` using `toWebHandler(app)` and `new Request('http://test.local' + path, init)`.

### 4.6 ALS propagation

ALS does **not** propagate through h3's handler chain automatically. The test fixture must wrap every `caller(path, init)` invocation in `dbContext.run({ trx }, () => caller(path, init))`. Do not rely on the test body's ALS context alone.

### 4.7 Auth gotchas

- **Session cookies are signed by better-auth.** Manually inserting a `sessions` row and sending the raw token as `better-auth.session_token` does **not** work. `signInAs` must either call better-auth's in-process endpoints or use a known signing helper.
- **Sign-up hook does not run for unverified users.** Because `requireEmailVerification: true`, the after-sign-up hook that creates org/membership is skipped. Test helpers must create `organizations` and `memberships` rows explicitly (this is what the current specs already do manually).
- **Redis must be available for sign-up.** better-auth triggers `enqueueEmail` on sign-up via the email plugin. Set `NUXT_REDIS_URL` in the test environment even though jobs are not processed.

### 4.8 Recommended API contract changes (already reflected in Section 8)

1. `createServerCaller()` must be wrapped by a fixture so each request runs inside `dbContext.run({ trx }, …)`.
2. `useRuntimeConfig` must be provided by the harness, not assumed from h3.
3. The in-process router must skip handlers that depend on Nuxt internals (configurable exclude list).
4. Auth helpers should use better-auth endpoints or a signing helper, not raw `sessions` inserts.
5. Fixture defaults for users should set `emailVerified: true` and create org/membership.

---

## 5. Mission — capability map

**Phase 1 — `@base/testing`:**

1. **DB provisioning (WS1a)** — template-database machinery, hardened for parallelism.
2. **Transactional in-process testing (WS1b)** — tests call handlers in-process; every query joins one transaction rolled back after the test.
3. **Build-once real-server e2e (WS1c)** — at most one Nuxt build per run; per-file servers spawn from the prebuilt output.
4. **Typed fixtures (WS2)** — declarative, type-checked fixture definitions with label references and FK wiring.
5. **Auth + queue test helpers (WS3, WS4)** — `signInAs`, verified-user factories, and Sidekiq-style fake/inline/real queue modes including BullMQ Flow support in inline mode.

**Phase 2 — `@base/auth` + `@base/jobs`:**

6. **Auth module (WS6)** — better-auth as a Nuxt module: config points in `nuxt.config.ts`, routeRules-based protection, organization plugin adoption, `can()` authorization helper, auth composables.
7. **Production jobs (WS7)** — `ApplicationJob` in `@base/jobs` (production home), worker bootstrap conventions, repeatable (cron) jobs, queue dashboard (Sidekiq-UI equivalent), `add-job` skill.

**Phase 3 — DX batteries:**

8. **Mailer (WS8)** — `@base/mail`: template convention, dev-only `/dev/mailbox` preview, email test assertions.
9. **Console + bin scripts (WS9)** — `pnpm console` REPL, `bin/setup`, `bin/dev`.
10. **Security, logging, cache, remaining skills (WS10)** — `nuxt-security` evaluation/install, request-ID + structured logging, cache facade, `add-migration` + `add-authed-route` skills.

---

## 6. Non-negotiables

- TypeScript strict. No `any` without a comment justifying it.
- ESLint (`@antfu/eslint-config`) must pass: `pnpm --filter web lint`.
- No Prisma. Kysely only.
- No new runtime dependencies without strong justification. `unimport` is already a devDependency in `apps/web`; move/add it in `@base/testing` as needed.
- Production behavior byte-for-byte unchanged when test affordances are not active.
- Do not modify `package.json` build scripts, `nuxt.config.ts` build config, or CI outside your workstream's file ownership. (Explicit exceptions: WS1a adds `db:schema:dump`; WS7 adds `jobs:work`; WS9 adds `console`, `bin/setup`, `bin/dev` wiring; WS6 adds the module registration in `nuxt.config.ts`.)
- Phase 1: everything lives in `packages/testing` **except**: the already-applied ALS patches (verify, do not alter); `apps/web/vitest.config.ts` + test setup files (WS1a/WS1c); the dogfood specs (WS5); and the `packages/jobs` skeleton + `ApplicationJob` home (WS4, see §8 note).
- `ApplicationJob` is a PRODUCTION convention. It lives in `packages/jobs` (`@base/jobs`) from the start — NOT in `@base/testing`. `@base/testing` provides the test adapters that plug into it. Do not put it in the testing package and migrate later.
- The public API surface is fixed by the API contract in Section 8. If unimplementable as written, stop and document why rather than silently diverge.

---

## 7. Performance requirements (acceptance gates)

1. **At most ONE Nuxt build per full-suite run**, regardless of test-file count.
2. In-process transactional tests (the default tier) **must not** trigger any Nuxt build or server spawn.
3. Real-server e2e tests spawn `node .output/server/index.mjs` (or cached equivalent) with per-file env — spawn time ~1s, not ~20s.
4. Full e2e suite passes with `pool: 'forks'`, `maxForks: 4`, no `maxForks: 1` anywhere — each file on its own database.
5. Component tests use `happy-dom` unless they genuinely need the Nuxt environment.
6. `TEST_HOST` mode (single shared dev server, shared DB) remains supported as the local dev-feedback loop, documented as trading isolation for speed; CI never uses it.

---

## 8. API contract — public exports

This contract is binding. Implement it exactly. Deviations require explicit approval and documentation.

### 8.1 Phase 1 — `@base/testing`

```ts
// ── WS1a: provisioning ─────────────────────────────────────────────

// Vitest globalSetup: advisory-locked template DB create/recreate from
// apps/web/db/schema.sql + optional seed. No-op for non-e2e runs.
export function globalSetupTemplateDb(opts: {
  appRoot: string
  adminDatabaseUrl?: string
  templateName?: string
  seedScriptPath?: string
}): Promise<() => Promise<void>>

// Vitest setupFiles entry: clones the template into a per-file database,
// sets process.env.NUXT_DATABASE_URL/DATABASE_URL before imports, drops
// the DB after the file. Returns the file's database URL.
export function withFileDatabase(opts: {
  appRoot: string
  adminDatabaseUrl?: string
  templateName?: string
}): Promise<string>

// Script (also exposed as a pnpm script in apps/web): dump schema.sql
// from the dev DB.
//   pnpm db:schema:dump
export function dumpSchema(opts: {
  appRoot: string
  databaseUrl: string
  outPath: string
}): Promise<void>

// ── WS1b: transactions + in-process server ─────────────────────────

// Vitest fixture. Extends vitest test with { db, trx, server, fixtures, queue }.
// db: Kysely<Database> over the file's database pool.
// trx: active Kysely Transaction for this test.
// server: in-process caller wrapping each request in the test's ALS context.
// fixtures: typed fixture loader.
// queue: queue-testing facade.
export const test: TestAPI<{
  db: Kysely<Database>
  trx: Kysely<Database>
  server: (path: string, init?: RequestInit) => Promise<Response>
  fixtures: FixtureLoader<typeof defaultSchema> // override via schema option
  queue: QueueTestingFacade
}>

// Lower-level helper to build the in-process caller. Consumers normally use
// the `server` fixture; this is exported for advanced use.
export function createServerCaller(opts?: {
  appRoot?: string
  excludeRoutes?: string[]
  runtimeConfig?: Record<string, unknown>
}): Promise<(path: string, init?: RequestInit) => Promise<Response>>

// ── WS1c: real-server e2e ──────────────────────────────────────────

// Global setup: ensures ONE build of the Nitro output exists (skips if fresh).
// Cache dir is gitignored.
export function globalSetupBuiltServer(opts: {
  appRoot: string
  cacheDir?: string
}): Promise<() => Promise<void>>

// Per-file helper: spawns the prebuilt server on an ephemeral port with the
// file's database env; returns base URL; kills the child after the file.
export function withBuiltServer(opts?: {
  baseUrl?: string
  env?: Record<string, string>
}): Promise<{ baseUrl: string }>

// ── WS2: fixtures ──────────────────────────────────────────────────

export function defineFixtures<S extends FixtureSchema>(schema: S): FixtureLoader<S>
// Usage:
//   const fx = await fixtures.load({
//     org:  fixture('organizations', { name: 'Acme' }),
//     user: fixture('users', { role: 'admin' }),
//     membership: fixture('memberships', {
//       user_id: ref('user'),
//       organization_id: ref('org'),
//     }),
//   })
// fx.user.id is fully typed from kysely-codegen types.

export function fixture<T extends Table>(
  table: T,
  attrs: Partial<Row<T>>,
): FixtureDef<T>

export function ref(label: string, column?: string): Ref

// ── WS3: auth helpers ──────────────────────────────────────────────

// Returns the full Cookie header value (e.g. "better-auth.session_token=...").
// Must work inside the test transaction.
export function signInAs(userId: string): Promise<string>

// Creates a verified user + default org + admin membership.
// Mirrors the intent of the current manual sign-up/verify/org/membership flow.
export function givenVerifiedUser(overrides?: Partial<Users>): Promise<{
  user: Users
  org: Organizations
  membership: Memberships
  cookies: string
}>

// ── WS4: queue testing (adapters + facade) ─────────────────────────

export type QueueMode = 'fake' | 'inline' | 'real'

export interface QueueTestingFacade {
  setMode(mode: QueueMode): void
  enqueuedJobs(queue?: string): EnqueuedJob[]
  performEnqueuedJobs(queue?: string, opts?: { includeDelayed?: boolean }): Promise<void>
  reset(): void
}

export const queue: QueueTestingFacade

export function defineFlow(name: string, build: FlowBuilder): FlowDef

// Registers the test adapter (fake/inline) into @base/jobs' adapter slot.
// Called automatically by the WS1b setup file.
export function installQueueTestAdapter(mode: QueueMode): void
```

### 8.2 Phase 2 — `@base/jobs` + `@base/auth`

```ts
// ── @base/jobs (WS7) — production home of the job convention ───────

export abstract class ApplicationJob<Data> {
  static queueName: string
  // Routes through the registered adapter: BullMQ in production,
  // fake/inline in tests (registered by @base/testing).
  static performLater(data: Data, opts?: JobOpts): Promise<void>
  abstract perform(data: Data): Promise<void>
}

// Adapter registry — exactly one adapter active at a time.
export function registerJobAdapter(adapter: JobAdapter): void

// Repeatable (cron) jobs — BullMQ repeatable jobs underneath.
export function defineCronJob(name: string, schedule: string, job: JobClass): CronJobDef

// Worker bootstrap for the separate prod process: loads the job registry
// and starts Workers for every registered queue. Invoked by `pnpm jobs:work`.
export function startAllWorkers(opts?: { concurrency?: number }): Promise<void>

// ── @base/auth (WS6) — Nuxt module ─────────────────────────────────
// Consumed in nuxt.config.ts:
//
//   modules: ['@base/auth'],
//   baseAuth: {
//     strategies: { emailPassword: true, github: { clientId, clientSecret } },
//     emailVerification: 'required',        // 'required' | 'optional' | 'off'
//     organizations: true,                  // better-auth organization plugin
//     hooks: { afterSignUp: 'server/auth/after-sign-up' },
//     routeRules: { '/admin/**': 'admin', '/app/**': true },
//   }

// Server helpers:
export function requireAuth(event: H3Event): Promise<{ user: User, session: Session }>
export function can(user: User, action: string, resource: unknown): boolean
export function definePolicy(resource: string, rules: PolicyRules): void

// App composables (auto-imported):
//   useAuthUser(), useAuthSession(), useCan(action, resource)
```

### 8.3 Phase 3 — `@base/mail` + scripts

```ts
// ── @base/mail (WS8) ───────────────────────────────────────────────
export function defineMailer<T>(name: string, build: (data: T) => {
  subject: string
  html: string
  text?: string
}): Mailer<T>
// Mailer.deliver(data) enqueues via the email ApplicationJob (@base/jobs).

// @base/testing addition (WS8):
export function expectEmail(opts: { to?: string, subject?: string | RegExp }): void

// ── Scripts (WS9) ──────────────────────────────────────────────────
//   pnpm console      — REPL with useDatabase, useAuth, useQueue, job registry preloaded
//   bin/setup         — install, create dev+test DBs, migrate, seed, schema dump
//   bin/dev           — nuxt dev + worker + dashboard, one terminal
```

---

## 9. Phase 1 workstreams

Spawn one agent per workstream. The orchestrator owns sequencing and integration.

---

### WS1a — DB provisioning

**Files you own:**

- `packages/testing/src/provisioning/test-database.ts`
- `packages/testing/src/provisioning/global-setup.ts`
- `packages/testing/src/provisioning/file-database.ts`
- `packages/testing/src/provisioning/dump-schema.ts`
- `packages/testing/src/provisioning/index.ts`
- `apps/web/scripts/dump-schema.ts` (thin wrapper re-exporting the above)
- `apps/web/db/schema.sql` (generated)
- `apps/web/test/global-setup.ts` (thin wrapper)
- `apps/web/test/e2e/setup.ts` (thin wrapper)
- `apps/web/vitest.config.ts` (shared with WS1c — coordinate via orchestrator)

**Build:**

1. Create the `packages/testing` skeleton first (WS0/orchestrator will do this, but WS1a defines the first real exports).
2. Port the cntctus test-database helpers into generic functions parameterized by `appRoot`, `adminDatabaseUrl`, `templateName`, etc.
3. Implement `dumpSchema` using `pg_dump --schema-only --no-owner --no-privileges --clean --if-exists`. Output to `apps/web/db/schema.sql`. Add a pnpm script `db:schema:dump` in `apps/web/package.json`.
4. Implement `createTemplateDatabase`:
   - Connect to the admin `postgres` database.
   - Acquire a Postgres advisory lock keyed by the template name (`SELECT pg_advisory_lock(hashtext($1))`).
   - Terminate any backends connected to the template if it exists.
   - Drop and recreate the template database.
   - Load `apps/web/db/schema.sql` via `psql -f`.
   - Optionally run a seed script if `seedScriptPath` is provided.
   - Set timezone UTC.
   - Release the advisory lock.
5. Implement `withFileDatabase`:
   - Runs as a Vitest `setupFiles` entry.
   - Creates a unique database name per file: `test_<app>_<pid>_<ts>_<random>`.
   - `CREATE DATABASE ... TEMPLATE <templateName>`.
   - Sets `process.env.NUXT_DATABASE_URL` and `process.env.DATABASE_URL` **before** the test file's modules are imported. This timing is load-bearing.
   - Registers a teardown to terminate backends and drop the file's database.
6. Wire `apps/web/vitest.config.ts`:
   - E2E project: `pool: 'forks'`, `maxForks: 4`.
   - `globalSetup: ['test/global-setup.ts']`.
   - `setupFiles: ['test/e2e/setup.ts']`.
   - Keep the `unit` and `nuxt` projects unchanged except where necessary.

**Done when:**

- `pnpm vitest run --project e2e` creates one template DB and one DB per file.
- Two concurrent `vitest` invocations on the same machine do not corrupt the template.
- The full existing e2e suite still passes (even if still using old patterns).

---

### WS1b — Transactional in-process testing

**Files you own:**

- `packages/testing/src/transaction.ts`
- `packages/testing/src/server-caller.ts`
- `packages/testing/src/runtime-config.ts`
- `packages/testing/src/test.ts`
- `packages/testing/src/index.ts` (partial — re-export WS1b symbols)

**Prerequisite:** read `spike/REPORT.md` and the spike code. The spike decision is binding.

**Build:**

1. **Runtime-config shim.** Create `packages/testing/src/runtime-config.ts` replicating `spike/runtime-config.ts`. It must:
   - Return `event.context.runtimeConfig` when an event is passed.
   - Fall back to env-derived config (`NUXT_DATABASE_URL`/`DATABASE_URL`) when called without an event.
   - Expose the same shape as `useRuntimeConfig` from Nitro (`{ databaseUrl, betterAuthSecret, public: { ... } }`).

2. **Auto-import infrastructure.** Create a Vitest plugin helper (used by `test.ts` setup) that applies the unimport config from the spike:
   - Preset: all h3 exports.
   - Preset: `useRuntimeConfig` from `@base/testing/runtime-config`.
   - Dirs: `apps/web/utils`, `apps/web/server/utils`, `apps/web/server/lib`.
   - Aliases: `~~`, `~`, `#server`, `@monorepo/shared`.

3. **Server caller (`server-caller.ts`).** Generalize `spike/server-caller.ts`:
   - `createServerCaller(opts?)` returns a `(path, init) => Promise<Response>`.
   - Register middleware in filename order from `apps/web/server/middleware/*.ts`.
   - Build file-based router from `apps/web/server/api/**/*.ts`.
   - Support `excludeRoutes` (e.g. `_sitemap-urls.ts`).
   - Inject `event.context.runtimeConfig` fallback before middleware runs.
   - Register catch-all `[...auth].ts` **after** specific routes.

4. **Transaction fixture (`transaction.ts`).**
   - Export an `AsyncLocalStorage`-based context matching `apps/web/utils/db.ts`'s `DbContext`.
   - Provide a vitest `test.extend` fixture that:
     - Creates one `Kysely<Database>` pool per file from `process.env.NUXT_DATABASE_URL`.
     - Per test: `const trx = await db.startTransaction().execute()`.
     - Runs the test inside `dbContext.run({ trx }, …)`.
     - Rolls back in teardown (`await trx.rollback().execute()`).
     - Destroys the file pool after the file.
   - Handle concurrent tests: each gets its own transaction/connection. Ensure pool size ≥ `maxForks` or cap concurrency.

5. **Server fixture integration.** The `server` fixture returned to tests must wrap each request:

   ```ts
   async (path, init) => {
     const activeTrx = dbContext.getStore()?.trx ?? testTrx
     return dbContext.run({ trx: activeTrx }, () => caller(path, init))
   }
   ```

6. **Setup file (`test.ts`).** A single Vitest setup file that:
   - Verifies `process.env.NUXT_DATABASE_URL` is set; fails fast with a clear message if not.
   - Registers the auto-import plugin.
   - Exports the extended `test` object.

**Done when:**

- A spec can use `test('...', async ({ server, trx }) => { ... })` to hit `/api/notifications`.
- The auth middleware sees a user created inside the same transaction.
- Rows inserted by the API are visible test-side and rolled back after the test.
- No `.output/` is produced and no Nuxt build runs.

---

### WS1c — Build-once real-server e2e

**Files you own:**

- `packages/testing/src/built-server.ts`
- `packages/testing/src/built-server-global-setup.ts`
- `apps/web/vitest.config.ts` (shared with WS1a — coordinate via orchestrator)

**Build:**

1. **Global setup.** Implement `globalSetupBuiltServer`:
   - Determine a cache directory (e.g. `apps/web/.test-output/` or `node_modules/.cache/@base/testing/nitro-output/`).
   - Compute a content hash or mtime heuristic over `apps/web/server/`, `apps/web/nuxt.config.ts`, `apps/web/package.json`, `pnpm-lock.yaml`.
   - If cached output is fresh, skip build.
   - Otherwise run `nuxt build` exactly once per run.
   - Return teardown that does **not** delete the cache (other files may reuse it).

2. **Per-file helper.** Implement `withBuiltServer`:
   - Spawn `node <cached-output>/server/index.mjs`.
   - Pass env: `NUXT_DATABASE_URL`, `DATABASE_URL`, `NUXT_REDIS_URL`, `NUXT_BETTER_AUTH_SECRET`, `PORT=0` or an ephemeral port.
   - Wait for readiness (poll `/api/healthcheck` or parse stdout).
   - Return `{ baseUrl: 'http://localhost:<port>' }`.
   - Kill the child in teardown.

3. **Vitest config.** Coordinate with WS1a to add the global setup for real-server tests only. The default e2e project uses in-process callers; a separate project or opt-in marker can use `withBuiltServer`.

4. **Keep `TEST_HOST` working.** Existing specs using `@nuxt/test-utils/e2e` `setup({ host: process.env.TEST_HOST })` must continue to work unchanged.

**Done when:**

- A 3-file real-server e2e suite triggers exactly one build.
- Each file's server boots in ~1s against its own database.
- `TEST_HOST` mode still works.

---

### WS2 — Typed fixtures

**Files you own:**

- `packages/testing/src/fixtures.ts`
- `packages/testing/src/fixture-types.ts`

**Build:**

1. Define `FixtureSchema`, `FixtureDef`, `Ref`, `FixtureLoader` types backed by `DB` from `@monorepo/shared`.
2. `defineFixtures(schema)` returns a loader.
3. `fixture(table, attrs)` declares a fixture. Unspecified columns get sensible defaults:
   - Strings: `<column>-<random>`.
   - Numbers: `0` or auto-incremented.
   - Booleans: `false` unless schema override.
   - Dates: `new Date()`.
   - Required FKs: must be supplied or referenced via `ref()`.
4. `ref(label, column = 'id')` resolves to the inserted row's value after the loader runs.
5. Insertion engine:
   - Build a dependency graph from `ref()` calls.
   - Detect cycles and throw a clear error naming the labels involved.
   - Insert in topological order.
   - If an FK violation occurs, throw naming the fixture label and ref.
6. Transaction integration:
   - Loader uses `dbContext.getStore()?.trx`.
   - If no transaction is active, throw with a message pointing to the docs.
7. Provide a default schema covering the tables most tests touch (`users`, `organizations`, `memberships`, `notifications`, `read_notifications`, `sessions`, `accounts`).

**Done when:**

```ts
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

compiles, inserts inside the active transaction, and `fx.user.id`/`fx.org.id` are typed correctly.

---

### WS3 — Auth test helpers

**Files you own:**

- `packages/testing/src/auth.ts`

**Build:**

1. `signInAs(userId)`:
   - Use better-auth's in-process API to create a real session for the user.
   - Recommended path: call `auth.api.signInEmail` or create a session via `auth.api` and extract the signed `better-auth.session_token` cookie.
   - Return the full `Cookie` header value (e.g. `better-auth.session_token=...`).
   - Must work inside the test transaction (auth queries go through `useDatabase`, which returns the active transaction).

2. `givenVerifiedUser(overrides?)`:
   - Build on WS2 fixtures.
   - Create a `users` row with `emailVerified: true`.
   - Create an `organizations` row.
   - Create a `memberships` row with `role: 'admin'`.
   - Sign in as the user.
   - Return `{ user, org, membership, cookies }`.

3. If better-auth's session format cannot be replicated reliably in-process, call `auth.api.*` endpoints and document the choice.

**Done when:**

```ts
const { user, cookies } = await givenVerifiedUser()
const res = await server('/api/notifications', { headers: { cookie: cookies } })
expect(res.status).toBe(200)
```

passes inside a test transaction and rolls back cleanly.

---

### WS4 — Queue testing modes

**Files you own:**

- `packages/testing/src/queue/adapter.ts`
- `packages/testing/src/queue/flow.ts`
- `packages/testing/src/queue/queue-testing.ts`
- `packages/testing/src/queue/index.ts`
- `packages/jobs/src/application-job.ts` (shared with WS7 — see below)

**Build:**

1. **`ApplicationJob<Data>` base class — in `packages/jobs`, not the testing package.** Create only the minimal skeleton here: the abstract class per §8.2 plus the `registerJobAdapter` slot. WS7 (Phase 2) fleshes out the rest of `@base/jobs`. If WS7 has already run, coordinate via orchestrator.
   - `static queueName: string`.
   - `static performLater(data, opts?)` routes through the active adapter.
   - `abstract perform(data): Promise<void>`.

2. Three adapters (in `@base/testing`):
   - `fake`: record jobs in memory. `enqueuedJobs()` returns them.
   - `inline`: await `perform(data)` immediately in the current async context. DB side-effects roll back with the test transaction.
   - `real`: delegate to the existing `useQueue()` BullMQ path.

3. `queueTesting` facade:
   - `setMode(mode)`.
   - `enqueuedJobs(queue?)`.
   - `performEnqueuedJobs(queue?, opts?)` drains recorded jobs in the **current** ALS context (capture at drain time).
   - `reset()` clears recorded jobs — auto-called per test by the WS1b setup.
   - Default mode in test env: `'fake'`.
   - `installQueueTestAdapter(mode)` wires the adapter into `@base/jobs`.

4. `defineFlow(name, build)`:
   - Models BullMQ `FlowProducer` parent/children DAG.
   - In inline/drain mode, topologically execute children → parents in-context.
   - Document the rationale: this works because execution is in-process, unlike Sidekiq in feature specs.

5. `real` mode draining:
   - `drainQueues()` spins a `Worker` per registered queue and blocks on `QueueEvents` until empty.
   - Use only for a small CI suite validating the BullMQ seam itself.

6. Delayed jobs:
   - Record `delay` in fake/inline mode.
   - Promote via `performEnqueuedJobs({ includeDelayed: true })` or a `travelTo(date)` clock helper.

7. Keep `useQueue`/`useWorker` untouched for production. `ApplicationJob` is a layered convention.

**Done when:**

- A spec can assert enqueue in fake mode.
- A spec can see a job's DB side-effects inside the test transaction in inline mode.
- A 3-node flow (2 children → 1 parent) runs end-to-end in one test and rolls back.

---

### WS5 — Dogfood, docs, and agent skills (Phase 1)

**Files you own:**

- `apps/web/test/e2e/notifications.get.spec.ts` (rewrite)
- `apps/web/test/e2e/admin-auth.spec.ts` (rewrite)
- `packages/testing/README.md`
- `skills/write-e2e-test/SKILL.md`
- `AGENTS.md` (Testing section only)

**Prerequisite:** WS1a, WS1b, WS2, WS3 must be functional before rewriting specs.

**Build:**

1. Rewrite `notifications.get.spec.ts`:
   - Use `test` from `@base/testing`.
   - Use `givenVerifiedUser()` to obtain a signed-in user + org.
   - Use fixtures to seed notifications.
   - Use the in-process `server` caller for all assertions.
   - Remove all raw SQL, manual cleanup, and cookie scraping.
   - Preserve every existing assertion.
   - Target: setup shrinks from ~60 lines of manual SQL to fixture/helper calls only.

2. Rewrite `admin-auth.spec.ts`:
   - Use `givenVerifiedUser()`.
   - For the admin route, the middleware checks `event.context.user.email === 'afifnajib@gmail.com'`. Use fixture overrides to set that email for the admin user.
   - Preserve the 401 and 403 assertions.

3. `README.md` for `@base/testing`:
   - Quickstart.
   - The five capabilities.
   - The three test tiers and when to use each:
     - **In-process transactional** = default for API behavior tests.
     - **Built-server** = smoke/SSR/auth-flow tests that need real HTTP.
     - **TEST_HOST** = local dev loop, trades isolation for speed.
   - Inline-mode rationale (why BullMQ flows are testable here).
   - Build-once performance model.
   - Required env vars (`NUXT_DATABASE_URL`, `NUXT_REDIS_URL`, `NUXT_BETTER_AUTH_SECRET`).
   - How to run `db:schema:dump`.

4. Agent skill:
   - `skills/write-e2e-test/SKILL.md` — template and rules for writing a new e2e spec.
   - Include plain `.tpl` files the skill references.

5. Update `AGENTS.md` Testing section:
   - Replace the current `@nuxt/test-utils/e2e` default guidance.
   - Point at `@base/testing` and the new skills.
   - Include the performance rules: never add a per-file build; default to the in-process tier.

**Done when:**

- Both rewritten specs pass.
- `notifications.get.spec.ts` setup shrinks to fixture/helper calls only.
- `pnpm --filter web lint` passes on rewritten specs.

---

## 10. Phase 2 workstreams — Auth module + production jobs

**Phase gate:** Phase 1 acceptance gates (§13.1) all green before Phase 2 starts.

---

### WS6 — Auth module (`packages/auth`, `@base/auth`)

**Files you own:**

- `packages/auth/**` (new)
- `apps/web/nuxt.config.ts` (module registration + `baseAuth` config only)
- `apps/web/server/api/[...auth].ts` (replace with module-provided handler)
- `apps/web/server/middleware/00-auth.ts`, `apps/web/server/middleware/admin.ts` (replace with module-provided equivalents)
- `apps/web/utils/auth.ts` (moved into the module; keep a re-export shim if app code imports it)
- `apps/web/migrations/<new>_betterauth_organization_plugin.ts` (if WS6.3 lands)
- `skills/use-auth/SKILL.md` (new)

**Build:**

1. **Nuxt module skeleton.** `defineNuxtModule` with options per §8.2 (`strategies`, `emailVerification`, `organizations`, `hooks`, `routeRules`). On setup:
   - Move the `useAuth(env)` factory into the module, parameterized by module options (keep the existing behavior as the default config).
   - Register the better-auth catch-all handler, session middleware, and admin guard from the module instead of app files.
   - Auto-import composables: `useAuthUser`, `useAuthSession`, `useCan`.
2. **routeRules-based protection.** Map `baseAuth.routeRules` entries to server middleware: `true` = authenticated, `'admin'` = admin only. Keep the existing hardcoded admin email working via config (`adminEmails: ['afifnajib@gmail.com']`) — no behavior regression.
3. **Organization plugin adoption (evaluate first, then implement).** better-auth's `organization` plugin provides organizations, memberships, invitations, and roles — the current manual sign-up hook duplicates a subset. If adopted:
   - Enable the plugin behind `organizations: true`.
   - Write a migration aligning existing `organizations`/`memberships` tables with the plugin's expected schema (or configure the plugin's model names to match existing tables — prefer configuration over data migration; document whichever you choose).
   - Replace the manual after-sign-up hook with plugin behavior, preserving "every new user gets a default org with admin role".
   - If the plugin cannot preserve current behavior exactly, document the delta and keep the manual hook behind a config flag.
4. **Authorization helper.** `definePolicy(resource, rules)` registry + `can(user, action, resource)` server helper + `useCan` composable. Ship with policies for the existing resources (notifications admin actions) as the worked example.
5. **`requireAuth(event)`** server helper replacing the repeated `if (!event.context.user) throw 401` pattern in handlers; refactor existing handlers to use it.
6. **Test compatibility.** `signInAs`/`givenVerifiedUser` from Phase 1 must keep working against the module-provided auth. Add module-level tests using the in-process tier.
7. **Skill:** `skills/use-auth/SKILL.md` — protecting routes, writing policies, testing authed endpoints.

**Done when:**

- Sign-up/sign-in/session/admin-guard behavior is unchanged from the app's perspective, but all wiring comes from the module + `baseAuth` config.
- `routeRules` protection works: unauthenticated → 401, non-admin → 403 on an admin rule.
- Existing Phase 1 dogfood specs still pass unmodified.

---

### WS7 — Production jobs (`packages/jobs`, `@base/jobs`) + dashboard

**Files you own:**

- `packages/jobs/**` (extends the WS4 skeleton)
- `apps/web/server/plugins/email-worker.ts` (refactor to the new worker bootstrap)
- `apps/web/server/lib/email.ts` (refactor `enqueueEmail` to an `EmailJob` ApplicationJob — keep `enqueueEmail` as a thin compatibility wrapper)
- `apps/web/package.json` (`jobs:work` script)
- `apps/web/nuxt.config.ts` (dashboard module registration only)
- `skills/add-job/SKILL.md` + templates

**Build:**

1. **Flesh out `@base/jobs`:**
   - `ApplicationJob` (from WS4) + `registerJobAdapter` + the production BullMQ adapter delegating to the existing `useQueue()` helper (preserving its retry/backoff/retention defaults).
   - A job registry: every `ApplicationJob` subclass registers itself on module load.
2. **Worker bootstrap conventions:**
   - Dev: a Nitro plugin starts workers in-process (env-gated, preserves current `email-worker.ts` behavior).
   - Prod: `pnpm jobs:work` runs a standalone Node entry calling `startAllWorkers()` — same registry, separate process. Document the deployment expectation (separate dyno/container/process).
   - Refactor `email-worker.ts` to the new convention; extract an `EmailJob` class; keep `enqueueEmail()` working as a wrapper for call sites (including better-auth hooks).
3. **Repeatable jobs:** `defineCronJob(name, schedule, job)` on BullMQ repeatable jobs, registered in the same registry (the Sidekiq-cron equivalent).
4. **Dashboard (the Sidekiq-UI equivalent).** Evaluate in this order; document the choice:
   - **Workbench (`@getworkbench/nuxt`)** — first-party Nuxt adapter for BullMQ dashboards.
   - **bull-board** — via an h3-compatible wrapper.
   - **Minimal custom routes** — reading BullMQ APIs via the queue registry, rendered as simple server-driven pages.
   Hard requirements: view queues, job counts by state, job detail + payload, failed-job retry; mounted at `/admin/queues` (or similar) and protected by the WS6 admin routeRules; available in dev via `bin/dev`.
5. **Queue tests still green:** Phase 1 queue-testing modes must work unchanged against the fleshed-out `@base/jobs` (the adapter seam is the integration point).
6. **Skill:** `skills/add-job/SKILL.md` — creating an ApplicationJob, registering, cron, dashboard visibility, and the test-mode behavior (fake/inline) from Phase 1. Include `.tpl` templates.

**Done when:**

- Emails still send end-to-end in dev (job enqueued, worker processes, via the new `EmailJob`).
- `pnpm jobs:work` boots a worker-only process that drains the email queue.
- The dashboard is reachable in dev, admin-protected, and can retry a failed job.
- A new job can be added by following only `skills/add-job/SKILL.md`.

---

## 11. Phase 3 workstreams — DX batteries

**Phase gate:** Phase 2 acceptance gates (§13.2) all green before Phase 3 starts.

---

### WS8 — Mailer (`packages/mail`, `@base/mail`)

**Files you own:**

- `packages/mail/**` (new)
- `apps/web/server/routes/dev/mailbox.get.ts` (dev-only, env-gated)
- `packages/testing/src/mail-assertions.ts` (addition to `@base/testing`)
- `apps/web/server/lib/email.ts` + better-auth mail call sites in `apps/web/utils/auth.ts` (route through mailers)

**Build:**

1. **Mailer convention:** `defineMailer(name, build)` per §8.3; `Mailer.deliver(data)` enqueues through the `EmailJob` ApplicationJob from `@base/jobs`. Templates are plain TS functions returning `{ subject, html, text? }` — no template engine dependency. Ship two real mailers by refactoring the existing better-auth emails: `ResetPasswordMailer`, `VerificationMailer`.
2. **Dev preview:** `/dev/mailbox` (404 outside development) lists all registered mailers and renders each with sample data — the Rails `/rails/mailers` preview equivalent.
3. **Test assertions:** `expectEmail({ to, subject })` in `@base/testing`, built on the WS4 fake queue (asserts an email job with matching payload was enqueued). Works with zero Redis.
4. **Dogfood:** a spec asserts that sign-up enqueues a verification email using `expectEmail` — no Redis, no Brevo key.

**Done when:** preview route renders both mailers in dev; the dogfood spec passes in the in-process tier.

---

### WS9 — Console + bin scripts

**Files you own:**

- `apps/web/scripts/console.ts`
- `bin/setup`, `bin/dev` (repo root, executable shell scripts or small Node scripts)
- `apps/web/package.json` + root `package.json` (script wiring only)

**Build:**

1. **`pnpm console`:** a jiti-powered Node REPL that loads `.env`, then preloads into scope: `db` (Kysely via `useDatabase`), `auth` (via `useAuth`), `useQueue`, the `@base/jobs` registry, and Kysely `sql`. Print a banner listing available handles. The `rails console` equivalent.
2. **`bin/setup`:** idempotent one-command setup — `pnpm install`, create dev + test databases if missing, `db:migrate`, optional seed, `db:schema:dump`. Mirrors Rails' `bin/setup`.
3. **`bin/dev`:** runs `nuxt dev` + `pnpm jobs:work` + (if WS7 installed it) the dashboard, with interleaved prefixed output (use `concurrently` as a devDependency, or a tiny Node spawner). One terminal for the whole stack.
4. Document all three in the README quickstart.

**Done when:** a fresh clone → `bin/setup` → `bin/dev` → app responds, worker processes a job, `pnpm console` can query `db.selectFrom('users').selectAll().execute()`.

---

### WS10 — Security, logging, cache, remaining skills

**Files you own:**

- `apps/web/nuxt.config.ts` (security module registration only)
- `apps/web/server/middleware/01-request-log.ts` (new)
- `apps/web/server/utils/cache.ts` (new)
- `skills/add-migration/SKILL.md`, `skills/add-authed-route/SKILL.md` (+ `.tpl` templates, + a tiny timestamp script if needed)
- `AGENTS.md` (Workflows/skills section update)

**Build:**

1. **Security defaults:** evaluate `nuxt-security`; install with a documented config (headers, rate limiting where sensible, CSRF for non-better-auth form routes). If any default breaks existing flows, document and tune rather than disable silently.
2. **Request logging:** middleware that assigns a request ID (honor inbound `x-request-id`), logs method/path/status/duration via consola, and exposes the ID on `event.context.requestId` for error reports.
3. **Cache facade:** thin typed wrapper over Nitro `useStorage` (`cache.fetch(key, ttl, fn)`) with a short README section on when to use it. Keep it minimal — this is a convention, not a framework.
4. **Skills:**
   - `add-migration` — timestamped kysely migration file conventions, running `db:migrate` + `db:migrate:generate` (codegen), the `db:schema:dump` follow-up, commit message convention. Any deterministic bits (timestamp filename) as a small script the skill calls.
   - `add-authed-route` — routeRules entry, `requireAuth`/`can()` usage, the required companion spec per `write-e2e-test`.
5. Update `AGENTS.md` with the full skills index.

**Done when:** security headers verified on a response; request logs show IDs in `bin/dev` output; both skills are followable end-to-end by an agent with no prior context.

---

## 12. Sequencing

**Phase 1:**

1. **Orchestrator (WS0)** creates `packages/testing` AND `packages/jobs` skeletons, registers them in `pnpm-workspace.yaml`.
2. **WS1a** lands first — it is mostly a port and unblocks everyone else.
3. **WS1b, WS1c, WS2, WS3, WS4** run in parallel. They build against the API contract, not each other's internals.
4. **Orchestrator** integrates seams, resolves API contract mismatches, and runs the full suite.
5. **WS5** runs last, after WS1–WS4 are integrated.

**Phase 2:**

6. **WS6** and **WS7** may run in parallel (disjoint file ownership; WS7's dashboard auth depends on WS6's routeRules — if WS6 is not done, WS7 stubs the guard behind config and the orchestrator wires it during integration).

**Phase 3:**

7. **WS8** after WS7 (depends on `EmailJob`). **WS9, WS10** may run in parallel with WS8.

---

## 13. Acceptance gates

### 13.1 Phase 1 gates (ALL must pass)

1. `pnpm --filter web test` — all three vitest projects green, including the two dogfooded specs.
2. `pnpm --filter web lint` and `pnpm --filter web build` pass.
3. `pnpm db:migrate` unchanged and working.
4. `pnpm db:schema:dump` produces a current `apps/web/db/schema.sql`.
5. Performance verified empirically:
   - Count builds per run: exactly one for any number of real-server e2e files.
   - Run e2e with `maxForks: 4`; all files pass.
   - Time a server spawn from the prebuilt output: ~1s.
6. Two concurrent `vitest` invocations on the same machine do not corrupt the template database.
7. `TEST_HOST=http://localhost:3001 pnpm vitest run test/e2e/healthcheck.get.spec.ts` still works.

### 13.2 Phase 2 gates (ALL must pass)

8. Auth behavior unchanged from the app's perspective; all wiring from `@base/auth` config.
9. routeRules: unauthenticated → 401; non-admin → 403 on an admin-guarded route; admin email(s) configurable.
10. Email flows end-to-end in dev through `EmailJob` (enqueue → worker → send attempt).
11. `pnpm jobs:work` boots a worker-only process that drains the email queue.
12. Queue dashboard reachable in dev, admin-protected, can retry a failed job.
13. All Phase 1 gates still green (including queue-testing modes against the production `@base/jobs`).

### 13.3 Phase 3 gates (ALL must pass)

14. `/dev/mailbox` renders all registered mailers in dev; 404 in non-dev.
15. A spec asserts sign-up enqueues a verification email via `expectEmail` — no Redis.
16. Fresh-clone path works: `bin/setup` → `bin/dev` → app + worker + dashboard up.
17. `pnpm console` opens a REPL that can query the database.
18. Security headers present on responses; request logs carry request IDs.
19. `skills/` contains: `write-e2e-test`, `add-job`, `use-auth`, `add-migration`, `add-authed-route`; `AGENTS.md` indexes them all.
20. All Phase 1–2 gates still green.

---

## 14. Risks and known issues

1. **Generalizing the router:** only a subset of `server/api/**` was exercised by the spike. Routes depending on `@nuxt/content`, `@nuxt/image`, or other Nuxt internals will need stubs or exclusion.
2. **Auto-import completeness:** the h3 preset + scanned dirs covered existing handlers, but any new global helper must be added to the unimport config.
3. **Auth pool sharing:** the `useAuth` change reuses `useDatabase(env)`. Note also the pre-existing pattern of a new `pg.Pool` per `useDatabase()`/`useAuth()` call in production — WS6 should centralize pool creation (one shared pool per process) as part of moving auth into the module.
4. **Redis dependency in tests:** sign-up triggers `enqueueEmail`. Tests need `NUXT_REDIS_URL` set even though jobs are not processed. (WS8's `expectEmail` removes the need to *process* email in tests.)
5. **Concurrency and ALS:** explicit per-request wrapping is safer than test-level ALS propagation. The `server` fixture must wrap every call.
6. **`requireEmailVerification` disables the org-creation hook:** verified-user factories must create org/membership explicitly.
7. **Organization plugin migration (WS6):** the better-auth organization plugin's schema may not map cleanly onto existing `organizations`/`memberships` tables. Prefer plugin model-name configuration over data migration; if behavior can't be preserved exactly, keep the manual hook behind a config flag and document the delta.
8. **Dashboard compatibility (WS7):** Workbench/bull-board compatibility with the app's Nuxt/Nitro versions is unverified — the evaluation order and fallbacks in WS7.4 exist for this reason.
9. **Module boundary discipline:** the long-term goal is "framework in `packages/`, app in `apps/`". Do not let app-specific business logic (e.g. notifications domain code) leak into `@base/*` packages; policies and mailers for app domains stay in `apps/web`, using the package conventions.

---

## 15. Appendices

### 15.1 Patch 1 diff (already applied in `apps/web/utils/db.ts`)

```ts
export interface DbContext {
  trx: Transaction<Database>
}

export const dbContext = new AsyncLocalStorage<DbContext>()

export function useDatabase(env: { databaseUrl: string }) {
  const activeTrx = dbContext.getStore()?.trx
  if (activeTrx)
    return activeTrx

  const pool = new pg.Pool({ connectionString: env.databaseUrl })
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
```

### 15.2 Patch 2 diff (already applied in `apps/web/utils/auth.ts`)

```ts
const db = useDatabase(env)
const auth = betterAuth({
  database: { db, type: 'postgres' },
  // ... rest unchanged
})
```

### 15.3 Route exclusions for in-process router

Start with:

```ts
const defaultExcludedRoutes = [
  'apps/web/server/api/_sitemap-urls.ts',
]
```

Make the exclude list configurable via `createServerCaller({ excludeRoutes })`.

### 15.4 Required test environment variables

```bash
NUXT_DATABASE_URL=postgresql://.../base_nuxt_app_test_template
NUXT_REDIS_URL=redis://...
NUXT_BETTER_AUTH_SECRET=any-non-empty-string-for-tests
```

### 15.5 File ownership summary

| Workstream | Files |
| --- | --- |
| WS1a | `packages/testing/src/provisioning/*`, `apps/web/scripts/dump-schema.ts`, `apps/web/db/schema.sql`, `apps/web/test/global-setup.ts`, `apps/web/test/e2e/setup.ts`, `apps/web/vitest.config.ts` (shared) |
| WS1b | `packages/testing/src/transaction.ts`, `packages/testing/src/server-caller.ts`, `packages/testing/src/runtime-config.ts`, `packages/testing/src/test.ts` |
| WS1c | `packages/testing/src/built-server.ts`, `packages/testing/src/built-server-global-setup.ts`, `apps/web/vitest.config.ts` (shared) |
| WS2 | `packages/testing/src/fixtures.ts`, `packages/testing/src/fixture-types.ts` |
| WS3 | `packages/testing/src/auth.ts` |
| WS4 | `packages/testing/src/queue/*`, `packages/jobs/src/application-job.ts` (shared with WS7) |
| WS5 | `apps/web/test/e2e/notifications.get.spec.ts`, `apps/web/test/e2e/admin-auth.spec.ts`, `packages/testing/README.md`, `skills/write-e2e-test/SKILL.md`, `AGENTS.md` |
| WS6 | `packages/auth/**`, `apps/web/nuxt.config.ts` (auth config only), `apps/web/server/api/[...auth].ts`, `apps/web/server/middleware/00-auth.ts`, `apps/web/server/middleware/admin.ts`, `apps/web/utils/auth.ts`, `skills/use-auth/SKILL.md` |
| WS7 | `packages/jobs/**`, `apps/web/server/plugins/email-worker.ts`, `apps/web/server/lib/email.ts`, `apps/web/package.json` (`jobs:work`), `skills/add-job/SKILL.md` |
| WS8 | `packages/mail/**`, `apps/web/server/routes/dev/mailbox.get.ts`, `packages/testing/src/mail-assertions.ts`, better-auth mail call sites |
| WS9 | `apps/web/scripts/console.ts`, `bin/setup`, `bin/dev`, package.json script wiring |
| WS10 | `apps/web/nuxt.config.ts` (security only), `apps/web/server/middleware/01-request-log.ts`, `apps/web/server/utils/cache.ts`, `skills/add-migration/`, `skills/add-authed-route/`, `AGENTS.md` |

---

## 16. Notes for the orchestrator

- Create `packages/testing/package.json` with `"name": "@base/testing"`, `"type": "module"`, and proper devDependencies (`typescript`, `vitest`, `kysely`, `pg`, `h3`, `unimport`, `bullmq`, `ioredis`, `@monorepo/shared`).
- Create `packages/jobs/package.json` with `"name": "@base/jobs"` in the same pass (WS4 needs it for `ApplicationJob`).
- Register both in `pnpm-workspace.yaml` (it already includes `packages/*`).
- Add a root `tsconfig.json` or extend from `apps/web/tsconfig.json` so the packages compile.
- Verify the two sanctioned patches are present in `main` before allowing WS1b to proceed.
- Ensure `apps/web/package.json` has the `db:schema:dump` script added by WS1a.
- Keep the `unit` project isolated from the e2e global setup; global setup should be project-specific.
- Phase gates are hard stops: do not start Phase 2 workstreams until §13.1 is green; same for Phase 3 and §13.2.
- At the end of each phase, deliver a summary: files created, deviations from this document with reasons, remaining risks.
