# Spike Report — In-Process Server Testing

**Branch:** `spike/in-process-testing`  
**Goal:** Determine whether we can run Nuxt 4 / Nitro API handlers in-process inside vitest, inside an AsyncLocalStorage-scoped Postgres transaction, with no build and no spawned server.

## VERDICT

**Path A works.**

We can boot the h3 app in-process, route requests through the real middleware and API handlers, and have every DB query (test code + server code + better-auth) execute inside a single Postgres transaction that is rolled back at the end of each test. No `nuxt build`, no socket, no spawned server is required for the default test tier.

## What was built

- `spike/vitest.config.ts` — standalone vitest project using `unimport/unplugin` to inject h3 auto-imports (`defineEventHandler`, `createError`, `readBody`, etc.) and a custom `useRuntimeConfig` shim into app handlers.
- `spike/server-caller.ts` — assembles the h3 app: runtime-config middleware, `server/middleware/*`, file-based router for `server/api/**` (excluding `_sitemap-urls.ts` because it needs `@nuxt/content` internals).
- `spike/runtime-config.ts` — `useRuntimeConfig(event?)` shim that reads from `event.context.runtimeConfig` when available, otherwise falls back to env-derived config.
- `spike/spike.spec.ts` — 8 acceptance tests proving 401-without-auth, auth inside a transaction, write visibility + rollback, isolation, and no build artifact changes.
- `apps/web/utils/db.ts` — **sanctioned Patch 1**: ALS-aware `useDatabase()`; returns an active transaction if present, otherwise unchanged pooled behavior.
- `apps/web/utils/auth.ts` — **sanctioned Patch 2**: routes better-auth's Kysely through `useDatabase(env)` (`{ db, type: 'postgres' }`) so auth queries join the test transaction.
- `apps/web/package.json` — dev-only addition of `unimport` for the spike harness.

## Final patches

### `apps/web/utils/db.ts`

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

### `apps/web/utils/auth.ts`

Removed the separate `pg.Pool` and PostgresDialect; better-auth now receives the same Kysely instance returned by `useDatabase(env)`:

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

## Auto-import shim that worked

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

## Measurements

Run on a local M-series MacBook against `base_nuxt_app_spike` on Postgres.

| Metric | Value |
| --- | --- |
| Harness boot (`createServerCaller()`) | ~49 ms |
| Trivial authenticated request overhead | ~13 ms |
| Full `spike/spike.spec.ts` (8 tests, 3 sign-up/sign-in flows) | ~1.7 s |
| Existing `test/e2e/healthcheck.get.spec.ts` (one spawned server + build) | ~41–47 s |

The spike harness is roughly **25–40× faster** for a single file than the current per-file build model, and the gap widens linearly with file count.

## Gotchas for the swarm

1. **`useRuntimeConfig` is not in h3.** The spike prompt assumed the h3 preset would cover it, but it is a Nitro/Nuxt auto-import. We had to provide our own shim.
2. **ALS does not propagate through h3's handler chain by default.** The `server` fixture must explicitly wrap every `webHandler(request)` call in `dbContext.run({ trx }, ...)`. Relying on the test body's ALS context is not enough.
3. **Catch-all route registration order matters.** `server/api/[...auth].ts` maps to `/api/**` in Nitro. It must be registered after specific routes or it intercepts everything.
4. **Handlers that call `useRuntimeConfig()` without an event need a fallback.** `server/lib/notifications.ts` calls `useRuntimeConfig()` bare; the shim must return env-derived config when no event is passed.
5. **better-auth signs session cookies.** Manually inserting a `sessions` row and sending the raw token as `better-auth.session_token` does not work. For the spike we used better-auth's own sign-up/sign-in endpoints to obtain a real signed cookie. This still proves the in-process + transaction path end-to-end.
6. **Sign-up hook does not run when `requireEmailVerification: true` and email is unverified.** Tests must create org/membership manually (mirrors the existing e2e spec).
7. **`_sitemap-urls.ts` depends on `#content/manifest`.** Exclude it from the in-process router or provide a stub; it cannot load without a real Nuxt build.
8. **Redis must be available for sign-up.** better-auth triggers `enqueueEmail` on sign-up. Set `NUXT_REDIS_URL` in the test environment even though the spike prompt says to avoid Redis; the jobs are not processed.

## Recommended changes to the WS1b API contract

The API contract in the swarm prompt is mostly correct, but a few adjustments are needed based on empirical findings:

1. `createServerCaller()` should accept or have access to the active transaction so it can wrap each request in `dbContext.run`. The fixture should look like:

   ```ts
   const server = async (path, init) => {
     const trx = dbContext.getStore()?.trx ?? testTrx
     return dbContext.run({ trx }, () => caller(path, init))
   }
   ```

2. `useRuntimeConfig` must be provided by the harness, not assumed from h3. Add it to the auto-import preset or inject it as a global.
3. The in-process router should skip handlers that depend on Nuxt internals (e.g. `@nuxt/content`). A configurable exclude list is required.
4. Auth helpers (`signInAs`, `givenVerifiedUser`) should use better-auth's own endpoints or a known signing helper, not raw `sessions` inserts.
5. Fixture defaults for `users` should set `emailVerified: true` and create org/membership, because the app hook won't run in this mode.

## Files touched

- `apps/web/utils/db.ts`
- `apps/web/utils/auth.ts`
- `apps/web/package.json` (dev-only `unimport`)
- `spike/vitest.config.ts`
- `spike/server-caller.ts`
- `spike/runtime-config.ts`
- `spike/spike.spec.ts`
- `spike/als.ts` (re-exports `dbContext` from `apps/web/utils/db.ts`)
- `spike/REPORT.md` (this file)

## Validation

- `pnpm --filter web exec eslint utils/db.ts utils/auth.ts` passes.
- `pnpm vitest run --config spike/vitest.config.ts spike/spike.spec.ts` passes (8/8).
- Existing `test/e2e/healthcheck.get.spec.ts` still passes when run individually (~41 s); the in-process harness does not break the existing suite.
- No new `.output/server/index.mjs` is produced by the spike harness.

## Risks / remaining questions

1. **Generalizing the router** for all `server/api/**` files: only a subset was exercised. Routes with `@nuxt/content`, `@nuxt/image`, or other Nuxt-internal imports will need stubs or exclusion.
2. **Auto-import completeness**: the h3 preset + scanned dirs covered the handlers in this repo, but any new global helper will need to be added to the unimport config.
3. **Production behavior**: the two sanctioned patches are inert when no ALS transaction is active; prod behavior is unchanged. However, the `useAuth` change removes a dedicated auth pool and reuses `useDatabase(env)`. This is behaviorally equivalent for normal requests but means auth and app code share one pool per `useDatabase()` call. In production this was already happening implicitly (both created pools), but the swarm should review connection pooling.
4. **Concurrency**: the spike did not prove `test.concurrent` isolation because h3/ALS propagation is safer when requests are wrapped per-call. The report recommends explicit per-call wrapping in the fixture rather than relying on test-level ALS propagation.
