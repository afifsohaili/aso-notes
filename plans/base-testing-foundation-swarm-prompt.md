# Swarm Prompt — `@base/testing` Foundation for base-nuxt-app (v2, Option C)

> Feed the ORCHESTRATOR BRIEF to the lead agent. Each WORKSTREAM section is a self-contained worker brief — spawn one agent per workstream. All agents share the CONTEXT, NON-NEGOTIABLES, and API CONTRACT sections verbatim.

---

## CONTEXT (all agents)

You are working in the private monorepo `afifsohaili/base-nuxt-app` (pnpm workspaces, Node, TypeScript strict).

Layout:
- `apps/web` — Nuxt 4.4 app (Nitro server in `apps/web/server`), Tailwind, vue-i18n, radix-vue
- `packages/shared` — shared types (kysely-codegen output: `packages/shared/types.d.ts`)
- `packages/components` — Vue components
- You are ADDING `packages/testing` (new workspace package, name: `@base/testing`)

Existing stack facts (verified from the repo — treat as ground truth):
- DB: Kysely 0.28 + `pg`, Postgres. Accessor: `useDatabase({ databaseUrl })` in `apps/web/utils/db.ts` — returns `new Kysely<Database>()` over a `pg.Pool`. Migrations via `kysely-ctl` (config at `apps/web/.config/kysely.config.ts`, folder `apps/web/migrations`). Type generation via `kysely-codegen`.
- Auth: better-auth 1.6, email+password, `requireEmailVerification: true`, instance created by `useAuth(env)` in `apps/web/utils/auth.ts`. Tables: `users`, `sessions`, `accounts`, `user_verifications`. Sign-up hook creates `organizations` + `memberships` rows.
- Queue: BullMQ 5 + ioredis. Helpers in `apps/web/server/utils/queue.ts` (`useQueue(name, opts)`) and `worker.ts` (`useWorker(name, fn, opts)`), both reading `NUXT_REDIS_URL`, with default retry/backoff/retention options already set.
- Tests: Vitest 4, three projects in `apps/web/vitest.config.ts` (`unit`, `e2e`, `nuxt`). E2E uses `@nuxt/test-utils/e2e` `setup()` + `$fetch`, supports `TEST_HOST` (pre-started dev server) or spawns a server per file — each spawned server pays a FULL Nuxt build (~20s, CPU-heavy). This per-file build tax is the suite's main performance problem.
- Current pain (see `apps/web/test/e2e/notifications.get.spec.ts`): every spec hand-rolls sign-up → manual `UPDATE users SET "emailVerified"=true` → manual org/membership inserts → sign-in → cookie scraping → raw-SQL seeding → FK-ordered manual `DELETE`s in `afterAll`. No transactional isolation is possible because the server runs in a separate process from the test.

## PROVEN PRIOR ART — port from `afifsohaili/cntctus` (all agents)

The sibling repo `cntctus` (same owner, same stack) has a working test-DB provisioning system. You are likely running on the owner's machine: check for local checkouts FIRST (e.g. `~/Projects/cntctus`, `~/Projects/base-nuxt-app` — `ls ~/Projects` to discover); reading locally is faster and avoids API rate limits. Fall back to GitHub access if absent. READ THESE FILES FIRST and port them into `@base/testing` (WS1a owns this):

- `apps/web/scripts/dump-schema.ts` — `pg_dump --schema-only --no-owner --no-privileges --clean --if-exists` → committed `db/schema.sql` (the Rails `schema.rb` equivalent).
- `apps/web/test/helpers/test-database.ts` — admin client on the `postgres` DB; `createTemplateDatabase()` (drop/recreate `test_template`, load `db/schema.sql` via `psql -f`, set timezone UTC); `seedTemplateDatabase()` (optional `scripts/seed.ts` run against the template); `createTestDatabase()` (`CREATE DATABASE test_<pid>_<ts> TEMPLATE test_template`); `dropTestDatabase()` (terminate backends, drop).
- `apps/web/test/global-setup.ts` — creates the template DB once per run (only for e2e runs).
- `apps/web/test/e2e/setup.ts` — per-FILE setup file: creates the file's own database from the template, then sets `process.env.NUXT_DATABASE_URL`/`DATABASE_URL` BEFORE the test file imports anything — setup files run in a fork before the Nuxt server build reads env. This timing trick is load-bearing; preserve it.
- `apps/web/vitest.config.ts` (cntctus) — `pool: 'forks'` for the e2e project. NOTE: cntctus caps `maxForks: 1`; we are REMOVING that cap (target: 4) — the provisioning design is already parallel-safe (pid-namespaced DBs).

Known gaps in cntctus you must fix while porting:
1. Template creation races if two vitest runs start concurrently on one machine → wrap template create/recreate in a Postgres advisory lock (`pg_advisory_lock`), and/or namespace the template name per run.
2. Isolation is per-FILE, not per-TEST — specs still hand-clean with `DELETE`s. WS1b fixes this.
3. Every spawned server pays a full Nuxt build. WS1c fixes this.

## MISSION (all agents)

Build `packages/testing` (`@base/testing`) implementing the RAILS PARALLEL TESTING MODEL:

> Rails: `parallelize(workers:)` clones one database per worker from `schema.rb`, then wraps each TEST in a transaction rolled back at teardown. We replicate exactly that: per-FILE databases cloned from a template (WS1a), per-TEST transactions for in-process tests (WS1b), one Nuxt build per run for tests that truly need a real server (WS1c).

Five capabilities:
1. **DB provisioning (WS1a)** — port the cntctus template-database machinery, hardened for parallelism.
2. **Transactional in-process testing (WS1b)** — tests call the Nitro/h3 app in-process; every DB query during a test (test code AND server code) runs inside one transaction that is rolled back after the test.
3. **Build-once real-server e2e (WS1c)** — at most ONE Nuxt build per run; per-file servers spawn from the prebuilt output against the file's own database.
4. **Typed fixtures (WS2)** — declarative, type-checked fixture definitions with label references and FK wiring.
5. **Auth + queue test helpers (WS3, WS4)** — `signInAs`, verified-user factories, Sidekiq-style fake/inline/real queue modes including BullMQ Flow (parent/children DAG) support in inline mode.

Success is proven by dogfooding: rewrite `notifications.get.spec.ts` and `admin-auth.spec.ts` on the new harness; both must pass with zero manual SQL in the spec bodies.

## NON-NEGOTIABLES (all agents)

- TypeScript strict. No `any` without a comment justifying it. ESLint (`@antfu/eslint-config`) must pass: `pnpm --filter web lint`.
- No Prisma. Kysely only. No new runtime dependencies without strong justification.
- Production behavior byte-for-byte unchanged: all test affordances are inert unless explicitly enabled (env-gated or adapter-gated).
- Do not modify `package.json` build scripts, `nuxt.config.ts` build config, or CI outside your workstream's file ownership.
- Everything lives in `packages/testing` EXCEPT: (a) the ALS-aware DB accessor hook in `apps/web/utils/db.ts` + routing `apps/web/utils/auth.ts` Kysely usage through it (WS1b only); (b) `apps/web/vitest.config.ts` + test setup files (WS1a/WS1c); (c) the dogfood specs (WS5).
- The public API surface is FIXED by the API CONTRACT. If unimplementable as written, stop and document why rather than silently diverging.

## PERFORMANCE REQUIREMENTS (acceptance gates, owned by orchestrator; designed by WS1a/1b/1c)

These exist because the current pattern (full Nuxt build per test file) makes the suite unbearably CPU-heavy. They are gates, not suggestions:

1. **At most ONE Nuxt build per full-suite run**, regardless of test-file count.
2. In-process transactional tests (the default tier) MUST NOT trigger any Nuxt build or server spawn.
3. Real-server e2e tests spawn `node .output/server/index.mjs` (or equivalent prebuilt Nitro output) with per-file env — spawn time ~1s, not ~20s.
4. Full e2e suite passes with `pool: 'forks'`, `maxForks: 4`, no `maxForks: 1` anywhere — each file on its own database.
5. Component tests use `happy-dom` unless they genuinely need the Nuxt environment.
6. `TEST_HOST` mode (single shared dev server, shared DB) remains supported as the local dev-feedback loop, documented as trading isolation for speed; CI never uses it.

## API CONTRACT (all agents — this is the shared interface)

```ts
// @base/testing — public exports

// ── WS1a: provisioning ─────────────────────────────────────────────
// Vitest globalSetup: advisory-locked template DB create/recreate from
// db/schema.sql + optional seed. No-op for non-e2e runs.
export function globalSetupTemplateDb(): Promise<() => Promise<void>>
// Vitest setupFiles entry: clones the template into a per-file database,
// sets process.env.NUXT_DATABASE_URL/DATABASE_URL before imports, drops
// the DB after the file. Returns the file's database URL.
export function withFileDatabase(): Promise<string>
// Script (also a pnpm script in apps/web): dump schema.sql from the dev DB.
//   pnpm db:schema:dump

// ── WS1b: transactions ─────────────────────────────────────────────
// Vitest fixture via test.extend. Every query inside the test — including
// in-process server handlers — joins one transaction; rolled back after.
export const test: TestAPI // extends vitest test with { db, fixtures, queue } fixtures
// In-process caller: boots the h3/Nitro app WITHOUT a Nuxt build or socket,
// returns a $fetch-like caller executing within the test's ALS context.
export function createServerCaller(): Promise<$Fetch>

// ── WS1c: real-server e2e ──────────────────────────────────────────
// Global setup: ensures ONE build of the Nitro output exists (skips if fresh).
// Per-file helper: spawns the prebuilt server on an ephemeral port with the
// file's database env; returns base URL; kills the process after the file.
export function withBuiltServer(): Promise<{ baseUrl: string }>

// ── WS2: fixtures ──────────────────────────────────────────────────
export function defineFixtures<S extends FixtureSchema>(schema: S): FixtureLoader<S>
//   const fx = await fixtures.load({
//     org:  fixture('organizations', { name: 'Acme' }),
//     user: fixture('users', { role: 'admin' }),
//     membership: fixture('memberships', { user_id: ref('user'), organization_id: ref('org') }),
//   })
// fx.user.id fully typed from kysely-codegen types.
export function fixture<T extends Table>(table: T, attrs: Partial<Row<T>>): FixtureDef<T>
export function ref(label: string, column?: string): Ref

// ── WS3: auth helpers ──────────────────────────────────────────────
export function signInAs(userId: string): Promise<string> // Cookie header value
export function givenVerifiedUser(overrides?: Partial<UserRow>): Promise<{ user: Row, org: Row }>

// ── WS4: queue testing ─────────────────────────────────────────────
export type QueueMode = 'fake' | 'inline' | 'real'
export const queueTesting: {
  setMode(mode: QueueMode): void          // default in test env: 'fake'
  enqueuedJobs(queue?: string): EnqueuedJob[]
  performEnqueuedJobs(queue?: string): Promise<void>   // drains fake queue in-context
  reset(): void                            // auto per test
}
export abstract class ApplicationJob<Data> {
  static queueName: string
  static performLater(data: Data, opts?: JobOpts): Promise<void>
  abstract perform(data: Data): Promise<void>
}
export function defineFlow(name: string, build: FlowBuilder): FlowDef

// ── WS1b hook in apps/web (the ONLY sanctioned app-code logic change) ──
// apps/web/utils/db.ts gains an AsyncLocalStorage-aware layer: useDatabase()
// keeps its signature and prod behavior; when a transaction is active in the
// current async context (set by @base/testing), it returns the transaction.
// apps/web/utils/auth.ts must route its Kysely usage through the same accessor.
```

## ORCHESTRATOR BRIEF (lead agent only)

1. Read the cntctus files listed in PROVEN PRIOR ART first, then `apps/web/utils/db.ts`, `apps/web/utils/auth.ts`, `apps/web/server/utils/queue.ts`, `apps/web/server/utils/worker.ts`, `apps/web/vitest.config.ts`, `apps/web/.config/kysely.config.ts`, `apps/web/test/e2e/*.spec.ts` in base-nuxt-app. Repos are source of truth where this prompt and code disagree.
2. Create `packages/testing` skeleton FIRST (package.json `"name": "@base/testing"`, tsconfig, pnpm workspace registration, export stubs) so all workers build against a real package.
3. Sequencing: WS1a first (it is mostly a port — fast, unblocks everyone) → then WS1b, WS1c, WS2, WS3, WS4 in parallel (WS2–4 build against the API CONTRACT, not each other's internals) → WS5 last.
4. Integration duty: verify the API CONTRACT is satisfied exactly, resolve seams, run the full suite.
5. Final gate (ALL must pass):
   - `pnpm --filter web test` — all three vitest projects green, including the two dogfooded specs
   - `pnpm --filter web lint` and `pnpm --filter web build`
   - `pnpm db:migrate` unchanged and working
   - Every PERFORMANCE REQUIREMENT verified empirically (count builds per run; run e2e with `maxForks: 4`; time a server spawn)
6. Deliver a summary: files created, deviations from this prompt with reasons, remaining risks.

---

## WORKSTREAM 1a — DB provisioning (port from cntctus)

**Files you own:** `packages/testing/src/provisioning/*.ts`, `packages/testing/src/bin/dump-schema.ts`, `apps/web/scripts/` (dump-schema only), `apps/web/db/schema.sql` (generated), `apps/web/test/global-setup.ts`, `apps/web/test/e2e/setup.ts`, `apps/web/vitest.config.ts` (shared with WS1c — coordinate via orchestrator).

**Build:**
- Port `dump-schema.ts`, `test-database.ts`, `global-setup.ts`, `e2e/setup.ts` from cntctus into `@base/testing` as generic functions parameterized by env (no hardcoded `test_template` name — derive from app name + run id).
- Add the advisory lock around template create/recreate (`SELECT pg_advisory_lock(hashtext($1))` on an admin connection; release after). Two concurrent runs must not corrupt each other; second run waits or reuses.
- Keep `psql`/`pg_dump` binary dependency (documented in README) — do NOT reinvent schema loading in JS.
- Per-file setup: `withFileDatabase()` per the API CONTRACT, preserving the env-swap-before-imports timing.
- vitest config: e2e project `pool: 'forks'`, `maxForks: 4`; wire globalSetup + setupFiles.

**Done when:** full e2e suite passes with 4 forks on 4 databases; two concurrent `vitest` invocations on the same machine do not corrupt the template.

## WORKSTREAM 1b — Transactional in-process testing

**Files you own:** `packages/testing/src/transaction.ts`, `packages/testing/src/server-caller.ts`, `packages/testing/src/test.ts`, `apps/web/utils/db.ts` (ALS layer ONLY), `apps/web/utils/auth.ts` (route Kysely through the shared accessor ONLY).

**Prerequisite — SPIKE REPORT IS BINDING:** before writing any code, look for `spike/REPORT.md` on branch `spike/in-process-testing` (or merged into main) in this repo. It contains the empirically chosen in-process boot path (Path A: direct h3 mounting / Path B: programmatic Nitro boot), the exact auto-import shim config, the proven diffs for the two sanctioned app-code patches, and measured timings. Implement THAT decision — do not re-run the investigation. Only if the report is absent, perform the investigation yourself:

**Build:**
- `AsyncLocalStorage<{ trx: Transaction<Database> }>` context in `@base/testing`. `useDatabase()` checks the store first; if a transaction is active, return it; otherwise the pooled Kysely instance exactly as today. Zero prod behavior change.
- `test.extend` fixture: per test, `BEGIN` on a dedicated connection from the file's database pool; run the test with the ALS context set; `ROLLBACK` in teardown. Handle concurrent tests within a file (each gets its own connection; size the pool or cap concurrency accordingly).
- `createServerCaller()`: boot the h3/Nitro app IN-PROCESS with NO Nuxt build. Investigate, in order: (a) importing server handlers directly with vitest aliasing of `#server`/auto-imports; (b) `@nuxt/test-utils` runtime/nuxt-environment facilities that expose the handler without building; (c) `nitro` dev primitives. Pick the fastest reliable path and document the choice. Verify empirically: a test that inserts via the caller, then asserts visibility from the test process within the same transaction.
- One vitest setup file registering the fixture; fails fast with a clear message if the file database env is missing.

**Done when:** a spec can use the caller to hit an API route that writes to Postgres, assert on the rows test-side, and leak nothing to the next test — no cleanup code, no build, no socket.

## WORKSTREAM 1c — Build-once real-server e2e

**Files you own:** `packages/testing/src/built-server.ts`, `apps/web/vitest.config.ts` (shared with WS1a — coordinate via orchestrator).

**Build:**
- Global setup: build the Nitro output ONCE per run if stale (content-hash or mtime heuristic over `server/`, `nuxt.config.ts`, `package.json`; document it). Store under a gitignored cache dir.
- `withBuiltServer()`: spawn `node .output/server/index.mjs` (or the cached equivalent) with env pointing at the file's database and `PORT=0`/ephemeral port; wait for readiness; return `{ baseUrl }`; kill the child after the file.
- Keep `@nuxt/test-utils` `setup()` + `TEST_HOST` working for the dev loop; document that CI uses `withBuiltServer`.

**Done when:** a 3-file e2e suite triggers exactly one build and each file's server boots in ~1s against its own database.

## WORKSTREAM 2 — Typed fixtures

**Files you own:** `packages/testing/src/fixtures.ts`, `packages/testing/src/fixture-types.ts`.

**Build:**
- `defineFixtures(schema)` mapping table names to kysely-codegen row types (from `@monorepo/shared`). Full type inference on `fixtures.load({...})` labels.
- Insertion engine: topological order from `ref()` dependencies (detect cycles, error clearly). Per-type sensible defaults for unspecified columns, overridable per schema, so `fixture('users', { email })` suffices.
- `ref(label, column?)` resolves to the inserted row's actual value (default `id`).
- Runs on the ambient WS1b transaction — fixtures never commit. (In non-transactional contexts, throw with a message pointing at the docs.)
- FK-violation errors must name the fixture label and ref that failed.

**Done when:** the API CONTRACT example compiles with correct inferred types and inserts correctly inside a transaction.

## WORKSTREAM 3 — Auth test helpers

**Files you own:** `packages/testing/src/auth.ts`.

**Build:**
- `signInAs(userId)`: create a `sessions` row exactly as better-auth would (inspect better-auth's session handling in `apps/web/utils/auth.ts` and its source: token format, expiry, cookie name/signing). Return the `Cookie` header value. Must work inside the test transaction.
- `givenVerifiedUser()`: builds on WS2 fixtures — `emailVerified: true` user + org + admin membership (mirrors what base-nuxt-app's specs do manually today).
- Fallback: if better-auth's session format can't be replicated reliably, call `auth.api.*` in-process instead — document the choice.

**Done when:** `const cookie = await signInAs(user.id)` then a request to `/api/notifications` with that cookie returns 200.

## WORKSTREAM 4 — Queue testing modes

**Files you own:** `packages/testing/src/queue/adapter.ts`, `packages/testing/src/queue/application-job.ts`, `packages/testing/src/queue/flow.ts`, `packages/testing/src/queue/queue-testing.ts`.

**Build:**
- `ApplicationJob<Data>` per API CONTRACT. `performLater` routes through the active adapter: `fake` (record in-memory), `inline` (await `perform` immediately in the current async context), `real` (existing `useQueue()` BullMQ path).
- `queueTesting` facade per contract, per-test auto-reset via the WS1b setup. `performEnqueuedJobs` drains recorded jobs in the TEST'S ALS context (capture at drain time, not enqueue time) — so job DB side-effects are visible and roll back with the test.
- `defineFlow`: models BullMQ `FlowProducer` parent/children. In inline/drain mode, topologically execute children→parents in-context. This is the capability Sidekiq cannot offer in feature specs (cross-process workers can't see transactional fixtures); it works here because execution is in-process. Document this rationale in the README.
- `real` mode: `drainQueues()` spins a `Worker` per registered queue and blocks on `QueueEvents` until empty — for a small CI suite validating the BullMQ seam itself.
- Delayed jobs in fake/inline mode: record with delay; promote via `performEnqueuedJobs({ includeDelayed: true })` or a `travelTo(date)` clock helper.
- Keep `useQueue`/`useWorker` untouched for prod; `ApplicationJob` is the new convention layered on top.

**Done when:** a spec can (a) assert enqueue in fake mode, (b) see a job's DB side-effects inside the test transaction in inline mode, (c) run a 3-node flow (2 children → 1 parent) end-to-end in one test with rollback.

## WORKSTREAM 5 — Dogfood, docs, agent skills (starts after WS1–4)

**Files you own:** `apps/web/test/e2e/notifications.get.spec.ts`, `apps/web/test/e2e/admin-auth.spec.ts` (rewrites), `packages/testing/README.md`, `skills/write-e2e-test/SKILL.md`, `skills/add-job/SKILL.md`, `AGENTS.md` (Testing section only).

**Build:**
- Rewrite both specs on the new harness: no raw SQL, no manual cleanup, no cookie scraping. Preserve every existing assertion. Default them to the in-process transactional tier unless an assertion genuinely needs a real server.
- README: quickstart; the five capabilities; the three test tiers and when to use each (in-process transactional = default; built-server = smoke/SSR/auth-flow; TEST_HOST = local dev loop); the inline-mode rationale (why flows are testable here when Sidekiq batches aren't in feature specs); the build-once performance model.
- Two agent skills following repo convention (AGENTS.md as table of contents): `write-e2e-test` and `add-job`. Templates as plain `.tpl` files the skills reference.
- Update AGENTS.md Testing section to point at the harness and skills, including the performance rules (never add a per-file build; default to the in-process tier).

**Done when:** both rewritten specs pass, and `notifications.get.spec.ts` setup shrinks from ~60 lines of manual SQL to fixture/helper calls only.
