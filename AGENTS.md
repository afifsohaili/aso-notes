# AGENTS.md — aso-notes

Agentic graph-RAG over personal notes. Keep this repo-specific guidance; don't duplicate what README / CONTEXT.md already say.

> **Important:** whenever terminology or domain language changes, update `@notes/aso-notes/CONTEXT.md`. It is the canonical glossary.

## Stack & layout

- **App:** Nuxt 4 monorepo under `apps/web` (frontend + Nitro server).
- **Packages:**
  - `packages/shared` → `@monorepo/shared` (generated Kysely DB types)
  - `packages/jobs` → `@base/jobs` (BullMQ job abstraction)
  - `packages/testing` → `@base/testing` (test harness, fixtures, auth helpers)
  - `packages/components` is currently unused.
- **DB:** PostgreSQL 16 with `pgvector` + Apache AGE, managed via Kysely migrations.
- **Queue/infra:** Redis for the ingestion pipeline and email worker.

## Prerequisites

- Node.js 24 (`.tool-versions`)
- pnpm 11 (`packageManager: pnpm@11.8.0`)
- Docker Compose for Postgres (port `5433`) and Redis (port `6379`)

## Everyday commands

Most root scripts just proxy to `apps/web`:

| Task | Command |
|------|---------|
| Install | `pnpm install` (runs `nuxt prepare` via `postinstall`) |
| Dev (HTTPS via portless) | `pnpm dev` → `https://asonotes.localhost` |
| Dev (raw, no portless) | `pnpm --filter web dev:app` → `http://localhost:3000` |
| Build | `pnpm build` |
| Preview | `pnpm preview` |
| Lint | `pnpm lint` / `pnpm lint:fix` |
| Type check | `pnpm --filter web nuxt typecheck` |
| Full test suite | `pnpm test` |
| Fast e2e only | `pnpm test:e2e` |
| Component tests | `pnpm test:components` |
| Run a single test | `pnpm --filter web vitest run --project e2e test/e2e/healthcheck.get.spec.ts` |
| Run component spec | `pnpm --filter web vitest run --project nuxt test/components/settings-page.nuxt.spec.ts` |
| Dev-loop against running server | `TEST_HOST=http://localhost:3001 pnpm --filter web vitest run test/e2e/...` |

## Database

- Migrations live in `apps/web/migrations`.
- Kysely config: `apps/web/.config/kysely.config.ts`.
- Migrate: `pnpm db:migrate`
- Migrate + regenerate types: `pnpm db:migrate:generate` → writes `packages/shared/types.d.ts`
- Dump schema: `pnpm db:schema:dump` → regenerates `apps/web/db/schema.sql` from migrations (creates a temp DB; requires `psql`)

## Environment

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill required values:

- `DATABASE_URL` / `NUXT_DATABASE_URL`
- `BETTER_AUTH_SECRET` / `NUXT_BETTER_AUTH_SECRET`
- `NUXT_REDIS_URL` — required for ingestion; without it synced notes stay `pending`
- `NUXT_LLM_AGENT_API_KEY`, `NUXT_LLM_EXTRACTION_API_KEY`, `NUXT_LLM_EMBEDDING_API_KEY` — OpenRouter by default (provider/model/base_url can be overridden per workspace from `/settings`; API keys are env-only)

Dev notes:

- Email verification and Turnstile are bypassed in `development`.
- Without Redis, folder sync still runs, but ingestion never executes.
- Synced folders are configured in-app from `/settings`; `NUXT_NOTES_DIR` is retired.

## Code conventions

- ESLint with `@antfu/eslint-config` + Vue. No Prettier.
- Vue 3 Composition API, `<script setup lang="ts">`.
- Use `ref()` for primitives, `reactive()` for objects.
- Tailwind CSS only — no inline styles.
- Icons via `unplugin-icons`: `import CogIcon from '~icons/heroicons/cog-6-tooth'` then `<CogIcon class="h-6 w-6" />`. No inline SVGs or `<img>` icons.
- Auth composable: `useSession()` from better-auth/vue (e.g. `const { session } = await useSession()`).
- DB access: `useDatabase({ databaseUrl })` in `utils/db.ts`.
- Error handling: `error instanceof Error`.
- i18n via `useI18n()` — ALWAYS `import { useI18n } from 'vue-i18n'` explicitly. The bare auto-import resolves to nuxt-seo-utils' stub (`t` returns its fallback arg), which silently blanks labels at runtime while component tests still pass.

## Testing

- Prefer integration tests over unit tests.
- Default tier is **in-process transactional** via `@base/testing`:
  - No Nuxt build, no server spawn.
  - One template DB per run, one DB per test file, one transaction per test (rolled back).
  - Use `test` from `@base/testing/test`, `givenVerifiedUser()` from `@base/testing/auth`, and `fixtures.load()` from `@base/testing/fixtures`.
- Queue assertions use the `queue` fixture (`fake` / `inline` / `real` modes).
- Built-server tests live in `test/e2e-built/` and run via `--project e2e-built`.
- See `packages/testing/README.md` and `skills/write-e2e-test/SKILL.md` for templates.
- Vitest swallows `console.log`; `throw new Error(JSON.stringify(value))` to inspect values.

## Architecture gotchas

- Background sync/ingestion: `server/plugins/notes-sync.ts` syncs every row in `synced_folders` for the workspace, then a sweeper enqueues `IngestNoteJobData` to BullMQ, consumed by `server/plugins/ingestion-worker.ts`.
- The sync plugin learns about in-app synced-folder changes via an in-process EventEmitter from the folder CRUD endpoints; no restart is needed.
- Set `NUXT_DISABLE_NOTES_SYNC=1` / `NUXT_DISABLE_EMAIL_WORKER=1` to disable background workers.
- The graph is stored in Apache AGE and queried with Cypher; embeddings live in `pgvector`.
- LLM provider config is per-use-case: `{AGENT|EXTRACTION|EMBEDDING}_{PROVIDER|BASE_URL|MODEL|API_KEY}`. Default provider is OpenRouter.
