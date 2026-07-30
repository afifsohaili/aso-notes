# Plan 007 — Onboarding & First-Run Setup

> **Wayfinder map** (label: `wayfinder:map`). This file is the shared map for the onboarding effort. When the way is clear, the **Author plan-007** ticket restructures this file into the final spec (same format as plans 003/004).

## Destination

A complete, unambiguous spec for onboarding & first-run setup — boilerplate ripped out, settings-page-as-wizard, synced-folder config, LLM provider/model settings, gated first run with mandatory end-to-end proof — ready to hand straight to implementation.

## Notes

- Domain: agentic graph-RAG over personal notes. Glossary: `notes/aso-notes/CONTEXT.md` (canonical — new terms must land there).
- Prior art to read before resolving tickets: `notes/aso-notes/003-topics-concepts/plan-003-topics-concepts.md` (settings infrastructure, rebuild machinery), `notes/aso-notes/004-extraction-observability/plan-004-extraction-observability.md` (queue/sweeper observability, last_run).
- Key code: `apps/web/server/plugins/notes-sync.ts` (watcher/sweeper boot), `apps/web/server/lib/ai/registry.ts` (env-only provider resolution), `apps/web/server/lib/pipeline/singleton.ts` (process-wide provider singleton), `apps/web/server/api/settings/` (existing settings API), `apps/web/app/pages/settings.vue` (existing settings page + danger zone).
- Prototype tickets use the `emotional-design-ux` skill per user request.
- Conventions: TDD via `@base/testing` in-process transactional harness; ESLint antfu; Tailwind only; heroicons; explicit `useI18n` imports.
- Tracker: local markdown (this directory). Tickets are sibling files; blocking via `blocked-by` links in frontmatter; a ticket is claimed by filling `claimed:`.

## Decisions so far

Locked during exploration + charting (pre-ticket, so no links):

- Boilerplate rip-out: landing page (9 `landing-page-*.vue` components) plus admin / articles / todos / dashboard pages and their unused APIs/components/tests. App surface becomes: login/signup, chat, notes, graph, queue, settings.
- `/chat` is the signed-in home (redirect target from `/`); signed-out → `/login`. First run on chat shows a guided first query.
- Settings page IS the wizard (progressive disclosure, no separate `/setup` route). Hard-gate middleware redirects all app pages to `/settings` until setup completes; first-run only, never re-gates.
- **Synced Folder** (new glossary term) — a DB table of synced top-level directories replaces the `NUXT_NOTES_DIR` env var entirely; clean break, no migration path, multi-folder from day one. Path must exist on disk (no auto-create).
- Provider + model for all three roles (agent, extraction, embedding) move to `workspace_settings` (resolution: workspace → env → code default). API keys stay env-only; UI only offers providers usable given env (openrouter needs its env key; ollama always offered). Model inputs are free text + per-role "test connection" button.
- Embedding model changes are guarded: output dims validated at save time, non-2048 rejected (schema is `halfvec(2048)`); UI warns that changing it requires a rebuild.
- Setup completes only on mandatory end-to-end proof: a test note written by the app into a synced folder must reach `status='ingested'`, then is auto-deleted via the normal unlink flow. No Redis = hard block (BullMQ is required infrastructure), surfaced clearly in the wizard.
- Removing a synced folder = partial wipe of its notes + orphan GC of derived graph rows (not a full rebuild).
- The running sync plugin learns of synced-folder changes via an in-process event from the settings/folder endpoints (no polling, no restart).
- [Embedding dims detection](ticket-embedding-dims-detection.md) — probe-always at save time for both providers (no metadata source exists); accept iff length == 2048; expect frequent rejects since most hosted embedding models aren't 2048-dim.
- Synced Folder data model closed: see [ticket-synced-folder-data-model.md](ticket-synced-folder-data-model.md). `notes` carries a per-root `synced_folder_id` FK; uniqueness is `(synced_folder_id, path)`; `folders` stays workspace-scoped in Phase 2; two roots display as a merged list with a known collision quirk; path edits = remove + re-add.
- Smoke-test note flow closed: see [ticket-smoke-test-note-flow.md](ticket-smoke-test-note-flow.md). File is `__aso-smoke-test.md` at the first synced folder root; endpoints `POST /api/onboarding/smoke-test` + `GET /api/onboarding/smoke-test?attemptId=...`; phases `written` → `pending` → `queued` → `processing` → `ingested` → `deleting` → `done` / `failed`; 3-minute timeout; Redis and synced-folder prerequisites are 409 hard-blocks; retry starts a fresh attempt and re-verify does not clear `onboarding.completed_at`.

## Tickets

<!-- frontier = open + unblocked + unclaimed. Resolve ONE per session (research tickets excepted). -->

- [Synced Folder data model](ticket-synced-folder-data-model.md) — grilling
- ~~[Wizard-mode UX options](ticket-wizard-mode-ux-options.md)~~ — prototype — **CLOSED 2026-07-30** (see Phase 4 implementation log)
- ~~[Smoke-test note flow](ticket-smoke-test-note-flow.md)~~ — grilling — **CLOSED 2026-07-31** (see Phase 5 implementation log)
- ~~[Embedding dims detection](ticket-embedding-dims-detection.md)~~ — research — **CLOSED 2026-07-30** (see Decisions so far)
- [Orphan GC rules](ticket-orphan-gc-rules.md) — grilling (blocked by Synced Folder data model)
- [Author plan-007](ticket-author-plan-007.md) — task (blocked by all above)

## Not yet specified

- Legacy org→workspace cleanup onboarding forces: signup auto-provisioning of the workspace, redirect into the wizard, the pending `organizations`→`workspaces` migration touchpoints (product.md decision 2/14).
- Post-clean-break env surface: `NUXT_NOTES_DIR` is retired; the remaining `NUXT_*` vars (DB, Redis, LLM API keys, auth) and `.env.example` / README rewrite are still TBD.
- Danger-zone interplay: the rebuild button must not touch synced-folder config; does rebuild re-trigger onboarding state? (Suspected: no — config is not derived data.)
- Test strategy for the gated wizard: the mandatory e2e proof needs queue + LLM, awkward in the transactional harness — likely stubbed boundaries, but the shape isn't sharp yet.
- i18n key layout for all new wizard UI (mechanical, but large).

## Out of scope

- Multi-user workspaces, sharing, per-user synced folders beyond the single-tenant MVP.
- Non-Markdown ingestion (YAML/PDF/Excalidraw) — deferred in plan-003, unchanged.
- Arbitrary embedding dimensions / `halfvec(2048)` schema migration.
- Server-side directory browser for folder picking (free-text absolute path + validation is the decision).

## Implementation log

### Phase 5 — Smoke-test note flow (2026-07-31)

Status: **closed** (ticket: [Smoke-test note flow](ticket-smoke-test-note-flow.md)).

Built:
- `server/lib/onboarding/smoke-test.ts`: state machine, prerequisites check, file write/cleanup, onboarding completion. Pure `deriveSmokeTestPhase` for testability.
- API endpoints: `POST /api/onboarding/smoke-test` (starts attempt), `GET /api/onboarding/smoke-test?attemptId=...` (polls state). 409 codes: `redis_required`, `no_synced_folder`, `stale_attempt`.
- File: `__aso-smoke-test.md` written to the first synced folder root; content is a minimal heading + sentence, wikilink-free.
- UI: `wizard-step-verify.vue` is now interactive — starts the test, polls the GET endpoint (1.5s), shows per-phase progress, surfaces last_run error detail with Retry. Steady-state settings gained a "Re-verify setup" section that runs the same flow in a card without clearing `onboarding.completed_at`.
- State phases: `written` → `pending` → `queued` → `processing` → `ingested` → `deleting` → `done` / `failed`. On `ingested`, the first GET response deletes the file; the next poll(s) wait for the unlink row to disappear, then set `onboarding.completed_at`.
- Timeout: 3 minutes → `failed` with guidance copy.
- Retry: a new POST deletes the stale file and note row, generates a new attempt id, and starts over.

Specs:
- `test/e2e/onboarding-smoke-test.spec.ts` (7 tests): full happy path, no-Redis 409, no-synced-folder 409, retry after failure.
- `test/unit/onboarding-smoke-test.spec.ts` (10 tests): pure state-derivation matrix + timeouts.
- `test/components/wizard-step-verify.nuxt.spec.ts` (4 tests): disabled state, start, done emission, failure + retry.

Test result:
- Full suite: **83 test files / 651 tests passed** (`pnpm test`).

Divergences / kept items:
- Tests drive `ingestNote` directly with stubbed LLM/embedding providers, rather than enqueueing through the queue fixture, because the ingestion pipeline uses raw BullMQ (not the `@base/jobs` `ApplicationJob` abstraction). This mirrors the existing plan-006 divergence.
- The first `GET` response after ingestion returns `ingested` and performs the file deletion; the client therefore sees `ingested` once before the `deleting`/`done` transition.
- Re-verify does **not** unset `onboarding.completed_at`; it only runs the smoke test again and reports the result.

### Phase 1 — Boilerplate rip-out + `/` redirect (2026-07-30)

Completed by agent session. Goal: delete all boilerplate marketing/admin/demo surfaces and make `/` redirect based on auth state.

Deleted:
- **Pages** — `index.vue` (replaced), `admin.vue`, `admin/notifications/index.vue`, `articles/[...slug].vue`, `dashboard/notifications/index.vue` (5 pages/components of page structure, 1 replaced).
- **Components** — 9 `landing-page-*.vue` components + `landing-page.vue`, `admin/notification-form.vue`, `notifications/notification-bell.vue`, `notifications/notification-item.vue` (13 components).
- **Middleware** — `app/middleware/admin.ts`, `server/middleware/admin.ts` (2).
- **Server APIs** — `admin/notifications/*`, `admin/workspaces/index.get.ts`, `notifications/*`, `todos/*` (including `todos/ws.ts`), `_sitemap-urls.ts` (10+ API files).
- **Lib** — `server/lib/notifications.ts` (1).
- **Content** — `content/articles/hello-world.md`, `content.config.ts` (1 article + config).
- **Nuxt config** — removed `@nuxt/content` module from `nuxt.config.ts`.
- **Tests** — `admin-auth.spec.ts`, `admin-notifications.spec.ts`, `notifications.get.spec.ts`, `todos.crud.spec.ts`, `todos.ws.spec.ts`, `todos.schema.spec.ts`, `landing-page.nuxt.spec.ts` (7 test files).

Redirect:
- `app/pages/index.vue` now SSR-redirects: signed-in → `/chat`, signed-out → `/login` using `await navigateTo(session.value ? '/chat' : '/login', { replace: true })`.
- Post-login/post-signup targets updated to `/chat` in `login-form.vue`, `signup-form.vue`, and `pages/signup.vue`.
- `pages/login.vue` now redirects signed-in visitors to `/chat`.

Specs:
- Added `test/e2e-built/home-redirect.spec.ts` (9 tests) covering `/` redirect per auth state and 404s for removed routes (`/admin`, `/admin/notifications`, `/dashboard/notifications`, `/articles/hello-world`, `/api/todos`, `/api/notifications`, `/api/admin/notifications`).
- Updated `test/e2e/in-process-smoke.spec.ts` to use `/api/healthcheck` instead of the deleted `/api/notifications`.

Test result:
- Full suite: **72 test files / 546 tests passed** (`pnpm test`).

Divergences / kept items:
- DB migrations and `schema.sql` for `todos` / `notifications` / `read_notifications` were left in place. No code references them; deleting them risks migration-history drift on the dev DB, so removal is deferred to a clean-break migration pass.
- `@nuxt/content` dependency remains in `package.json` but is no longer loaded in `nuxt.config.ts`.
- `packages/testing/README.md` updated to remove the obsolete `todos.ws.spec.ts` reference; `server-caller.ts` cleaned up the stale `_sitemap-urls.ts` exclusion.

### Phase 2 — Synced Folder data model (2026-07-30)

Status: **closed** (ticket: [Synced Folder data model](ticket-synced-folder-data-model.md)).

Built:
- Migration `20260730000000_synced_folders.ts` adds `synced_folders` table, `notes.synced_folder_id` FK, switches note uniqueness to `(synced_folder_id, path)`, and backfills one default folder per workspace. A BEFORE INSERT trigger fills a fallback `synced_folder_id` so legacy/test fixtures don't break.
- Sync engine multi-root: `server/plugins/notes-sync.ts` now loads all `synced_folders` rows, starts one chokidar watcher per root, and sweeps per workspace. `server/lib/sync/files.ts` scopes upsert/unlink/rename/startup-scan by `synced_folder_id`.
- In-process reload seam: `server/lib/sync/synced-folders.ts` exports `syncedFolderEvents`; `POST /api/synced-folders` emits `added`, `DELETE` emits `removed`. The plugin starts/stops watchers in response.
- Folder CRUD API: `GET /api/synced-folders`, `POST /api/synced-folders`, `DELETE /api/synced-folders/:id` with absolute-path, directory-exists, duplicate, and nesting validations. Interim delete returns 409 when notes exist.
- Retired `NUXT_NOTES_DIR`: removed from `nuxt.config.ts` runtime config and `.env.example`. `server/api/notes/[...slug].ts` resolves the root from the note's `synced_folder` (or falls back to the workspace's first folder for new notes).
- Updated tests: `notes-sync.spec.ts`, `folder-sync.spec.ts`, `notes-api.spec.ts`, `notes-schema.spec.ts`; added `test/e2e/synced-folders-api.spec.ts` and `test/unit/synced-folders.validation.spec.ts`.

Test result:
- Full suite: **74 test files / 570 tests passed** (`pnpm test`).

Divergences / kept items:
- `folders` table was intentionally left workspace-scoped, not per-synced-folder. This means two Synced Folders with the same relative folder path share one `folders` row and the notes UI merges their trees. Root `__folder-cover.md` files would also collide on the `/` folder row. Recorded as a known interim quirk for Phase 4 UI to resolve.
- A BEFORE INSERT trigger provides a fallback `synced_folder_id` for test fixtures and legacy inserts; application code always supplies the value explicitly. This avoids a broad test-fixture churn while keeping the column NOT NULL in the DB.
- Interim deletion of a Synced Folder returns 409 if notes exist; Phase 6 will replace this with note wipe + orphan GC.
- The `DELETE` endpoint uses `ON DELETE CASCADE` on `notes.synced_folder_id` as a safety net, but the 409 guard prevents the cascade from firing through the API.

### Phase 3 — LLM provider settings + test-connection (2026-07-30)

Built:
- New `workspace_settings` keys: `llm.agent.{provider,model,base_url}`, `llm.extraction.{provider,model,base_url}`, `llm.embedding.{provider,model,base_url}`. Registered in `assertKnownSettingKey`/`normalizeSettingValue` with validation (provider ∈ {openrouter,ollama}; model non-empty string; base_url optional string/null).
- Resolution chain implemented in `server/lib/ai/registry.ts` (`resolveLLMProvider`, `resolveEmbeddingProvider`) and `server/lib/settings.ts` (`resolveLLMProviderSettings`, `resolveEmbeddingProviderSettings`, `resolveWorkspaceSettings`): workspace_settings → env (`NUXT_LLM_*`) → code default. `createLLMProvider`/`createEmbeddingProvider` remain env-only shorthands for tests.
- Singleton invalidation: `getStageRegistry()` (pipeline) and `getAgentProviders()` (agent) are now workspace-aware and cached. `PATCH /api/settings` calls `clearStageRegistry()` + `clearAgentProviders()` whenever an `llm.*` key changes so the next use re-resolves.
- `POST /api/settings/test-connection` tests a given `{ role, provider, model, base_url? }` without saving: chat roles do a minimal completion; embedding probes with one tiny input and no `dimensions` param, accepting only 2048 dims (mismatch returns `{ ok: false, dims, expected: 2048 }`). All provider errors return `{ ok: false, error }`; 4xx reserved for malformed/authz.
- Updated call sites: `runPipeline` awaits `getStageRegistry(ctx.db)`; `POST /api/conversations` awaits `getAgentProviders(db, workspaceId)`.

Specs:
- Updated `test/unit/settings.spec.ts` (37 tests) and new `test/unit/llm-registry.spec.ts` (13 tests) for validation, resolution-chain precedence, and defaults.
- New `test/e2e/settings-test-connection.spec.ts` (6 tests) covering authz, malformed body, ollama chat success, embedding success/dims-mismatch, and unreachable error.
- Updated `test/e2e/settings-api.spec.ts` for LLM PATCH persistence and invalid-value rejection.

Test result:
- Full suite: **76 test files / 607 tests passed** when run isolated; **606 passed + 1 flake** in full run (`test/e2e/folder-sync.spec.ts` chokidar timing; passes isolated as before).

Divergences / kept items:
- `resolveWorkspaceSettings` reports env-derived effective values as `source: 'default'` (there is no separate 'env' source; the existing two-source contract was preserved).
- Timeout for test-connection is hardcoded: 30s for ollama, 15s for openrouter. Not exposed as a setting in Phase 3.
- The Ollama embedding probe uses raw `fetch` to `/api/embed` so we can omit the `dimensions` param; the OpenRouter probe uses the provider class because it already omits `dimensions`.
- No UI work in this phase; Phase 4 will wire the test-connection call before save.

### Phase 4 — Wizard-mode settings + first-run chat + onboarding gate (2026-07-30)

Status: **closed** (ticket: [Wizard-mode UX options](ticket-wizard-mode-ux-options.md)).

Built:
- `onboarding.completed_at` registered in `workspace_settings` as the canonical flag; `PATCH /api/settings` supports deleting it by passing `value: null`, which re-enters wizard mode for tests.
- Onboarding gate middleware (`app/middleware/onboarding.ts`) checks onboarding status on the server via `useRequestFetch` and client-side via `$fetch`, redirecting protected pages (`/chat`, `/notes`, `/graph`, `/notes/queue`) to `/settings` when incomplete. Steady-state settings loads without redirect. Shared status cache in `app/composables/onboarding.ts`.
- `GET /api/settings/providers` returns per-role provider availability (`openrouter` enabled only if its env key is present; `ollama` always enabled).
- Wizard-mode `/settings` UI: progress steps (folder → LLM roles → verify), folder manager, LLM role cards, Redis hard-block banner, verify placeholder. Steady-state UI keeps the same folder/LLM sections alongside extraction strategy and danger zone.
- LLM role cards (`llm-role-card.vue`) bind provider/model/base-url locally, emit updates, test connection before save, and enforce the 2048-dim embedding guard at save time.
- First-run `/chat` empty state (`chat/index.vue`) shows a guiding card with adaptive suggestion chips based on whether notes have been ingested.

Specs:
- `test/e2e-built/onboarding-gate.spec.ts` (6 tests) — gate redirect/no-redirect cases across signed-out, incomplete, and completed onboarding states.
- `test/e2e/settings-api.spec.ts` updated for `onboarding.completed_at` persistence and deletion; `test/e2e/settings-providers.spec.ts` new for provider availability.
- `test/unit/settings.spec.ts` updated for onboarding setting validation.
- `test/components/settings-page.nuxt.spec.ts` (8 tests) — steady-state strategy/rebuild + wizard rendering, Redis warning, step locking, and LLM step enabling after folder add.
- `test/components/llm-role-card.nuxt.spec.ts` (5 tests) — rendering, disabled unavailable providers, model input emits, empty-model test button, OK status.
- `test/components/chat-index-page.nuxt.spec.ts` (2 tests) — first-run title and adaptive suggestions.

Test result:
- Full suite: **80 test files / 630 tests passed** (`pnpm test`).

Divergences / kept items:
- The verify step is only a placeholder; the actual smoke-test note flow (write → ingest → auto-delete) is deferred to the next ticket ([Smoke-test note flow](ticket-smoke-test-note-flow.md)).
- The onboarding gate is a client-side route middleware; a direct server-rendered request to a protected page would still need to rely on the client redirect. This is acceptable for the SPA but could be hardened with a server-side guard later.
- Provider availability is computed server-side from env keys; the UI only hides/disables providers that are missing, it does not let the user add keys.
- Removing a synced folder still returns 409 if notes exist; the smoke-test note will exercise the deletion path once implemented.
