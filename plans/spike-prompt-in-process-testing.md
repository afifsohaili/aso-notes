# Spike Prompt — In-Process Server Testing for base-nuxt-app

> Single-agent spike for kimi-code CLI. Run this BEFORE any swarm work.
> Its output (a decision report) feeds Workstream 1b of the swarm phase.

## ROLE & GOAL

You are spiking ONE question in the `base-nuxt-app` repo (run from the repo root):

> **Can we boot this Nuxt 4 app's Nitro/h3 server IN-PROCESS inside vitest — with no `nuxt build`, no socket, no spawned server — such that API handlers execute inside an AsyncLocalStorage-scoped Postgres transaction owned by the test?**

Deliver a working proof + a written verdict. This is a spike: optimize for learning, not polish. Timebox yourself: if Path A (below) isn't green after a genuine effort, move to Path B, and if both fail, document precisely why — a documented failure is a successful spike.

## SETUP

1. Work on a new branch: `git checkout -b spike/in-process-testing`.
2. All spike code goes in `spike/` at the repo root. You MAY make small, documented, experimental edits to `apps/web/utils/db.ts` and `apps/web/utils/auth.ts` on this branch (see THE TWO PATCHES below) — nothing else in app code may change.
3. Database: create a scratch DB on the local Postgres, e.g. `createdb base_nuxt_app_spike`, then run migrations against it with `NUXT_DATABASE_URL=postgresql://...@127.0.0.1/base_nuxt_app_spike pnpm --filter web db:migrate` (check how `.config/kysely.config.ts` reads env first).
4. Redis: avoid entirely. Do not boot the email-worker Nitro plugin; do not call `enqueueEmail`.
5. Do not install production dependencies. Dev-only additions allowed in `spike/` scope (e.g. `unimport`, matching `h3` version) — add to `apps/web` devDependencies and note them in the report.
6. Env for the spike: copy `apps/web/.env` values but point `NUXT_DATABASE_URL`/`DATABASE_URL` at the spike DB. `BETTER_AUTH_SECRET` must be non-empty (any string).

## CONTEXT (verified repo facts — trust these)

- Stack: Nuxt 4.4, Nitro (h3 v1), Kysely 0.28 + `pg`, better-auth 1.6, BullMQ (avoid), Vitest 4 with projects `unit`/`e2e`/`nuxt` in `apps/web/vitest.config.ts`.
- Server code uses Nitro AUTO-IMPORTS with no import statements: `defineEventHandler`, `createError`, `useRuntimeConfig`, `getQuery`, `readBody`, `setResponseStatus`, `toWebRequest`, `getRequestURL`, plus app-level auto-imports `useDatabase`/`testDatabase` (from `apps/web/utils/db.ts`), `useAuth` (`apps/web/utils/auth.ts`), `useQueue`/`useWorker` (`apps/web/server/utils/*`).
- Aliases: `~~/` and `~/` → `apps/web/`, `#server` → `apps/web/server`, `@monorepo/shared` → `packages/shared/types.d.ts` (type-only).
- Auth flow in server: `server/middleware/auth.ts` runs on every `/api/**` (except `/api/auth/**`), calls `useAuth(useRuntimeConfig(event)).api.getSession({ headers: event.headers })`, sets `event.context.user`. `server/middleware/admin.ts` guards `/api/admin/**`.
- `useDatabase(env)` currently returns `new Kysely<Database>()` over a NEW `pg.Pool` per call (reads `env.databaseUrl`, i.e. `NUXT_DATABASE_URL`).
- `useAuth(env)` currently creates its OWN `pg.Pool` and passes `{ dialect: new PostgresDialect({ pool }), type: 'postgres' }` to better-auth — its queries do NOT go through `useDatabase`. better-auth's `database` option also accepts a Kysely instance directly: `{ db: <kysely>, type: 'postgres' }`.
- better-auth tables: `users`, `sessions` (session token cookie name: `better-auth.session_token`), `accounts`, `user_verifications`. App tables: `organizations`, `memberships`, `notifications`, `read_notifications`. Types in `packages/shared/types.d.ts` (`DB` interface).
- Existing e2e pattern to replace: `apps/web/test/e2e/notifications.get.spec.ts` — ~60 lines of manual sign-up/verify/seed/cleanup. Your spike is the foundation that deletes that.

## THE TWO PATCHES (the sanctioned app-code changes to prototype)

**Patch 1 — `apps/web/utils/db.ts` (ALS-aware accessor).** Keep signature `useDatabase(env)` and identical prod behavior. Add: an `AsyncLocalStorage` store (define it in the spike package area, e.g. `spike/als.ts`, imported by db.ts); when a transaction is active in the current async context, return it instead of building a new pool:

```ts
// sketch — refine as needed
export function useDatabase(env: { databaseUrl: string }) {
  const active = dbContext.getStore()
  if (active?.trx) return active.trx // Kysely Transaction — same query API
  // ...original pooled path unchanged
}
```

**Patch 2 — `apps/web/utils/auth.ts` (route auth through the accessor).** Change better-auth's `database` to use the SAME `useDatabase(env)` instance (`{ db, type: 'postgres' }` form) so `auth.api.getSession` runs inside the active transaction. Verify better-auth accepts a Kysely instance (a `Transaction` object must work too — check its source if unsure). Prod behavior must be unchanged when no transaction is active.

## PATH A — direct h3 mounting, no build (try FIRST)

Replicate Nitro's runtime wiring in a vitest-local harness (`spike/server-caller.ts`):

1. **Auto-import shim.** In the spike's vitest config, add the `unimport` vite plugin configured with:
   - a preset covering h3's exports — the reliable trick: `presets: [{ from: 'h3', imports: Object.keys(h3) }]` (import h3 in the config file). This covers `defineEventHandler`, `createError`, `useRuntimeConfig`, `toWebRequest`, etc.
   - `dirs` scanning `apps/web/utils`, `apps/web/server/utils`, `apps/web/server/lib` for app-level auto-imports.
   - IMPORTANT: use the SAME h3 version Nitro resolves (`pnpm why h3` / lockfile) to avoid dual-h3 identity issues.
   - Also alias `~~`, `~`, `#server`, `@monorepo/shared` in `resolve.alias`.
2. **App assembly.** `createApp()` from h3; register `server/middleware/auth.ts` and `server/middleware/admin.ts` as global middleware (in filename order, as Nitro does); `createRouter()` and mount `server/api/**` handlers replicating Nitro's file-based routing (`notifications/index.get.ts` → `GET /api/notifications`, `[...auth].ts` → `/api/auth/**` catch-all if needed). Skip `server/plugins/*` (workers) entirely.
3. **In-process caller.** Wrap with `toWebHandler(app)` (or h3's equivalent) and expose `caller(path, init) => Promise<Response>` built on `new Request('http://test.local' + path, init)`. No sockets.
4. **Runtime config.** Plain h3's `useRuntimeConfig` falls back to env-derived config (NUXT_ prefixed env vars → camelCase keys) when no Nitro context exists — verify this empirically; if it doesn't hold, inject a minimal runtimeConfig into the event context in a wrapper middleware and document the workaround.

## PATH B — programmatic Nitro boot (only if A fails)

Investigate booting the Nitro dev server programmatically in-process (Nitro dev primitives / Nuxt kit) WITHOUT a production build, and getting its h3 app or a `localFetch`. Success criteria identical. Document what you tried even if it works — we need to know the boot time.

## ACCEPTANCE TESTS (`spike/spike.spec.ts` — all must pass for the verdict "Path X works")

Write a vitest file (own config, `environment: 'node'`) proving:

1. **Middleware chain:** `GET /api/notifications` with no cookie → 401.
2. **Auth inside the transaction (the money test):** inside a test transaction, insert a `users` row + `sessions` row (any token, far-future expiry); call `GET /api/notifications` with header `cookie: better-auth.session_token=<token>` → 200. This proves the auth middleware's `getSession` saw UNCOMMITTED data (requires Patch 2). Also insert org + membership + a notification row and assert the response body contains it.
3. **Writes visible + rollback:** test 1 writes via the API (e.g. `PUT /api/notifications` with `mark_all: true`) and asserts test-side via Kysely; test 2 (after) asserts those rows are GONE — rollback works, zero cleanup code.
4. **No build:** prove no `.output/` was produced and no `nuxi build`/`nuxt build` ran (the vitest config must not invoke either).
5. **Measurements:** report (a) harness boot time, (b) per-test overhead vs a trivial test, (c) time for the full spike spec. Compare against one existing e2e file's runtime (`pnpm vitest run test/e2e/healthcheck.get.spec.ts` timing as baseline).
6. **Concurrency note:** two `test.concurrent` tests each in their own transaction must not see each other's rows (Kysely checks out a separate pooled connection per `startTransaction()` — verify pool size ≥ 2; document the constraint).

Transaction fixture sketch (refine freely): per test, `const trx = await db.startTransaction().execute()`, run the test body inside `dbContext.run({ trx }, ...)`, then `await trx.rollback().execute()` in teardown. Wrap as a vitest `test.extend` fixture — this is the future `@base/testing` API, so keep it clean.

## DELIVERABLES

1. The working `spike/` directory on branch `spike/in-process-testing` (committed locally; do NOT push, do NOT merge).
2. `spike/REPORT.md` containing:
   - **VERDICT:** Path A works / Path B works / neither works (with exact failure reasons).
   - The two patches as final diffs (or note if they weren't needed as designed).
   - The exact auto-import shim config that worked.
   - Measurements from acceptance test 5.
   - Gotchas the swarm must know (h3 version pinning, runtimeConfig workaround, better-auth db option behavior, pool sizing).
   - **Recommended changes to the WS1b API contract**, if any.
3. A clean working tree state: `pnpm --filter web lint` passes on files you touched; existing `pnpm --filter web test` suite still passes UNTOUCHED (your spike adds files, it doesn't break existing ones).

## RULES

- Do not refactor app code beyond the two patches. Do not "improve" unrelated code.
- Do not modify `package.json` scripts, `nuxt.config.ts`, or CI.
- If you find yourself redesigning fixtures, queue testing, or auth helpers — stop. Those are other workstreams; this spike answers only the in-process + transaction question.
- Ask before any action that touches the user's non-spike databases.
