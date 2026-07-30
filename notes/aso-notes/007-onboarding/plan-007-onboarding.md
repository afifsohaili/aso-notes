# Plan 007 — Onboarding & First-Run Setup

Status: **Phase 1–6 DONE** (2026-07-30/31). Final spec; ready as implementation record.
Glossary: see `notes/aso-notes/CONTEXT.md` (Onboarding, Synced Folder, Note Status, Ingestion).

## Problem

- The app shipped with boilerplate marketing/admin/demo surfaces (landing page, admin, articles, todos, dashboard, notifications) that are unrelated to a personal-notes assistant.
- Notes were synced from a single `NUXT_NOTES_DIR` env var: one root per deployment, requires a redeploy to change, and not workspace-scoped.
- First-run setup was implicit: a user could reach chat before configuring synced folders or LLM providers.
- LLM provider/model were env-only; there was no per-workspace override surface and no way to test a configuration before saving.
- Embedding model changes could silently break the `halfvec(2048)` schema.
- There was no end-to-end proof that sync → ingestion actually works in a fresh workspace.

## Locked decisions

1. **Boilerplate rip-out.** Delete landing-page components, admin pages/APIs, articles (content module + page), todos API/page/WebSocket, dashboard notifications, notification bell, and related tests. App surface becomes: login/signup, chat, notes, graph, queue, settings.
2. **Entry redirects.** `/` SSR-redirects: signed-in → `/chat`, signed-out → `/login`. Post-login and post-signup targets are `/chat`.
3. **Settings page is the wizard.** Progressive disclosure inside `/settings`; no separate `/setup` route. A hard-gate middleware redirects protected app pages (`/chat`, `/notes`, `/graph`, `/notes/queue`) to `/settings` until onboarding completes. First-run only; it never re-gates once `onboarding.completed_at` is set.
4. **Synced Folder replaces `NUXT_NOTES_DIR`.** A DB table of top-level synced directories, workspace-scoped, multi-folder from day one. Path must already exist on disk; no auto-create. Clean break with no migration path.
5. **LLM settings resolution chain.** For provider, model, and base URL of each role (agent / extraction / embedding): `workspace_settings` → env (`NUXT_LLM_*`) → code default. API keys stay env-only and are not surfaced or stored in the UI.
6. **Embedding dimension guard.** Save-time probe for both providers, one tiny non-empty input, no `dimensions` param; accept iff the returned vector length is exactly 2048. Most hosted embedding models are rejected.
7. **Mandatory end-to-end proof.** Onboarding completes only after the app writes a smoke-test note into a synced folder, it reaches `status='ingested'`, and is then auto-deleted via the normal unlink flow. No Redis = hard block.
8. **Orphan GC on folder removal.** Removing a synced folder wipes its notes inline and garbage-collects orphaned concepts/relations/topics. Shared rows survive; user tags and dismissals for the wiped notes are deleted.
9. **In-process sync reload.** Synced-folder add/remove emits events that the running sync plugin consumes to start/stop watchers; no polling, no restart.

## Data model changes

| Table | Change | Notes |
| ----- | ------ | ----- |
| `synced_folders` | **new**: `id` uuid default, `workspace_id` FK cascade, `path` text (absolute), `created_at`/`updated_at`. Unique `(workspace_id, path)`. | Replaces `NUXT_NOTES_DIR`. No display-name/status/last-scan columns; UI derives from basename and note statuses. |
| `notes` | **new**: `synced_folder_id` FK cascade, NOT NULL after backfill. Unique on `(synced_folder_id, path)`. | Paths are relative to the synced folder root. |
| `workspace_settings` | **new keys**: `llm.agent.{provider,model,base_url}`, `llm.extraction.{provider,model,base_url}`, `llm.embedding.{provider,model,base_url}`, `onboarding.completed_at`. | Existing composite PK `(workspace_id, key)`. Values validated in `server/lib/settings.ts`. |

Migration (`20260730000000_synced_folders.ts`) creates the table, adds the FK, switches uniqueness, backfills one default synced folder per workspace (using `NUXT_NOTES_DIR` if set at migration time, else a placeholder), and installs a `BEFORE INSERT` trigger that supplies a fallback `synced_folder_id` for legacy/test fixtures.

## AGE graph changes

No new vertex/edge types. Orphan GC removes Note/Concept/Topic vertices and all incident edges for deleted rows in the same transaction, preserving the plan-003 same-transaction mirror discipline.

## Parts changing

### Boilerplate rip-out + entry redirects

- Deleted: 9 `landing-page-*.vue` components + `landing-page.vue`; `admin.vue`, `admin/notifications/index.vue`, `articles/[...slug].vue`, `dashboard/notifications/index.vue`; `admin/notification-form.vue`, `notifications/notification-bell.vue`, `notifications/notification-item.vue`; `admin.ts` middlewares (app + server); `admin/notifications/*`, `admin/workspaces/index.get.ts`, `notifications/*`, `todos/*` (including `todos/ws.ts`), `_sitemap-urls.ts` APIs; `server/lib/notifications.ts`; `content/articles/hello-world.md`, `content.config.ts`; `@nuxt/content` module load in `nuxt.config.ts`; 7 related test files.
- `app/pages/index.vue` SSR-redirects based on session.
- `login-form.vue`, `signup-form.vue`, `pages/signup.vue`, `pages/login.vue` updated to target `/chat`.

### Synced Folder data model + multi-root sync

- `server/plugins/notes-sync.ts`: loads every `synced_folders` row for the workspace, starts one `chokidar` watcher per root, sweeps per root.
- `server/lib/sync/files.ts`: upsert/unlink/rename/startup-scan scoped by `synced_folder_id`.
- `server/lib/sync/synced-folders.ts`: exports `syncedFolderEvents` EventEmitter.
- Folder CRUD API: `GET /api/synced-folders`, `POST /api/synced-folders`, `DELETE /api/synced-folders/:id`. Validations: absolute path, directory exists, duplicate `(workspace_id, path)`, no nesting. Interim delete returns 409 when notes exist (Phase 6 replaces this with orphan GC).
- `POST` emits `added`, `DELETE` emits `removed`; the plugin starts/stops watchers in response.
- `server/api/notes/[...slug].ts` resolves the root from the note's `synced_folder` (or falls back to the workspace's first folder for new notes).
- `NUXT_NOTES_DIR` removed from `nuxt.config.ts` runtime config and `.env.example`.

### LLM provider settings + test-connection

- New `workspace_settings` keys registered in `assertKnownSettingKey`/`normalizeSettingValue`. Provider ∈ `{openrouter,ollama}`; model non-empty string; base URL optional string/null.
- Resolution chain implemented in `server/lib/ai/registry.ts` and `server/lib/settings.ts`: workspace → env → code default.
- `createLLMProvider`/`createEmbeddingProvider` remain env-only shorthands for tests.
- Singleton invalidation: `getStageRegistry()` (pipeline) and `getAgentProviders()` (agent) are workspace-aware and cached. `PATCH /api/settings` calls `clearStageRegistry()` + `clearAgentProviders()` whenever an `llm.*` key changes.
- `POST /api/settings/test-connection`: tests `{ role, provider, model, base_url? }` without saving. Chat roles do a minimal completion. Embedding probes one tiny input with no `dimensions` param; mismatch returns `{ ok: false, dims, expected: 2048 }`. Provider errors return `{ ok: false, error }`; 4xx reserved for malformed/authz. Hardcoded timeouts: 30s for ollama, 15s for openrouter.
- Call sites updated: `runPipeline` awaits `getStageRegistry(ctx.db)`; `POST /api/conversations` awaits `getAgentProviders(db, workspaceId)`.

### Wizard-mode settings + first-run chat + onboarding gate

- `onboarding.completed_at` registered in `workspace_settings`; `PATCH /api/settings` supports deleting it by passing `value: null` (for tests / re-entry).
- Onboarding gate middleware (`app/middleware/onboarding.ts`) checks status server-side via `useRequestFetch` and client-side via `$fetch`, redirecting protected pages to `/settings` when incomplete.
- `app/composables/onboarding.ts`: shared status cache.
- `GET /api/settings/providers` returns per-role provider availability (`openrouter` only if its env key is present; `ollama` always enabled).
- Wizard-mode `/settings` UI: progress steps (folder → LLM roles → verify), folder manager, LLM role cards, Redis hard-block banner, verify step.
- LLM role cards (`llm-role-card.vue`) bind provider/model/base-url locally, test connection before save, enforce the 2048-dim embedding guard.
- Steady-state `/settings` keeps folder/LLM sections alongside extraction strategy and danger zone.
- First-run `/chat` empty state (`chat/index.vue`) shows a guiding card with adaptive suggestion chips based on whether notes have been ingested.

### Smoke-test note flow

- `server/lib/onboarding/smoke-test.ts`: state machine, prerequisites, file write/cleanup, onboarding completion. Pure `deriveSmokeTestPhase` for testability.
- Endpoints: `POST /api/onboarding/smoke-test` starts; `GET /api/onboarding/smoke-test?attemptId=...` polls.
- File: `__aso-smoke-test.md` at the first synced folder root (first by `created_at`); minimal heading + sentence, wikilink-free.
- Phases: `written` → `pending` → `queued` → `processing` → `ingested` → `deleting` → `done` / `failed`.
- Delete semantics: the first `GET` that sees `status='ingested'` deletes the file, then waits for the normal unlink flow to remove the note row before setting `onboarding.completed_at`.
- 409 prerequisites: `redis_required`, `no_synced_folder`; 409 `stale_attempt` for mismatched `attemptId`.
- Timeout: 3 minutes → `failed` with guidance copy and `last_run` detail.
- Retry: fresh POST deletes stale file/note row and starts a new attempt. Steady-state re-verify does **not** clear `onboarding.completed_at`.
- UI: `wizard-step-verify.vue` starts the test, polls (1.5s), shows per-phase progress, surfaces error detail with Retry.

### Orphan GC on synced-folder removal

- `server/lib/sync/gc.ts`: pure `planOrphanGc` decision core + `removeSyncedFolderAndCollectGarbage` DB implementation.
- `DELETE /api/synced-folders/:id` runs inline partial wipe + orphan GC in one transaction (savepoint when inside a host transaction), returning a wipe summary JSON.
- Cascade list for the removed folder's notes: chunks, mentions, links, sources, AI tags, `note_tag_dismissals`, user tags. Concepts with zero remaining mentions are deleted; Relations touching a dead Concept are deleted (FK cascade); Topics with zero remaining Concepts are deleted. Shared concepts/topics survive.
- AGE mirror cleanup for deleted Notes/Concepts/Topics in the same transaction.
- UI: `synced-folder-manager.vue` type-to-confirm dialog shows affected note count and requires typing `REMOVE` before confirm enables.

## Build order / milestones

Each milestone was TDD-driven; full suite green before the next.

- [x] **Phase 1 — Boilerplate rip-out + `/` redirect** — DONE 2026-07-30 (`71f193c`). Full suite: **72 test files / 546 tests passed**.
- [x] **Phase 2 — Synced Folder data model** — DONE 2026-07-30 (`21c9236`). Migration, multi-root sync, folder CRUD, in-process reload, `NUXT_NOTES_DIR` retired. Full suite: **74 test files / 570 tests passed**.
- [x] **Phase 3 — LLM provider settings + test-connection** — DONE 2026-07-30 (`babe326`). Resolution chain, validation, singleton invalidation, test-connection endpoint. Full suite: **76 test files / 607 tests passed** (1 known chokidar flake in full runs).
- [x] **Phase 4 — Wizard-mode settings + first-run chat + onboarding gate** — DONE 2026-07-30 (`743861b`). Wizard UI, gate middleware, providers endpoint, first-run chat state. Full suite: **80 test files / 630 tests passed**.
- [x] **Phase 5 — Smoke-test note flow** — DONE 2026-07-31 (`deff817`). State machine, endpoints, auto-delete, retry, re-verify. Full suite: **83 test files / 651 tests passed**.
- [x] **Phase 6 — Orphan GC on synced-folder removal** — DONE 2026-07-30 (`6ab36c4`). Decision core, inline GC, AGE cleanup, REMOVE confirmation UI. Full suite: **85 test files / 663 tests passed**.

## Divergences / kept items

### Phase 1
- DB migrations and `schema.sql` for `todos` / `notifications` / `read_notifications` were left in place to avoid migration-history drift on dev DBs; removal deferred to a clean-break migration pass.
- `@nuxt/content` dependency remains in `package.json` but is no longer loaded.
- `packages/testing/README.md` and `server-caller.ts` cleaned up stale references.

### Phase 2
- `folders` table was intentionally left workspace-scoped, not per-synced-folder. Two Synced Folders with the same relative folder path share one `folders` row and the notes UI merges their trees. Root `__folder-cover.md` files also collide on the `/` folder row. Recorded as a known interim quirk.
- A `BEFORE INSERT` trigger provides a fallback `synced_folder_id` for test fixtures and legacy inserts; application code always supplies it explicitly.
- Interim deletion returned 409 if notes exist; Phase 6 replaced this with orphan GC.
- `DELETE` endpoint uses `ON DELETE CASCADE` on `notes.synced_folder_id` as a safety net, but the 409 guard prevented the cascade from firing through the API.

### Phase 3
- `resolveWorkspaceSettings` reports env-derived effective values as `source: 'default'` (there is no separate `'env'` source; the existing two-source contract was preserved).
- Test-connection timeout is hardcoded: 30s for ollama, 15s for openrouter. Not exposed as a setting in this phase.
- The Ollama embedding probe uses raw `fetch` to `/api/embed` so it can omit the `dimensions` param; OpenRouter uses the provider class because it already omits `dimensions`.

### Phase 4
- The verify step was initially a placeholder; the actual smoke-test note flow was implemented in Phase 5.
- The onboarding gate is a client-side route middleware; a direct server-rendered request to a protected page still relies on the client redirect. Acceptable for the SPA; could be hardened with a server-side guard later.
- Provider availability is computed server-side from env keys; the UI only hides/disables missing providers, it does not let the user add keys.

### Phase 5
- Tests drive `ingestNote` directly with stubbed LLM/embedding providers rather than enqueueing through the `@base/jobs` queue fixture, because the ingestion pipeline uses raw BullMQ (not the `@base/jobs` abstraction). Mirrors the existing plan-006 divergence.
- The first `GET` response after ingestion returns `ingested` and performs the file deletion; the client therefore sees `ingested` once before the `deleting`/`done` transition.
- Re-verify does **not** unset `onboarding.completed_at`; it only runs the smoke test again and reports the result.

### Phase 6
- User-origin `note_tags` and `note_tag_dismissals` for wiped Notes are deleted with the Note. This differs from a full rebuild (which preserves user tags workspace-wide) because a partial wipe scopes deletion to the removed folder's Notes.
- Surviving Concepts keep their existing embedding/description (never-overwrite rule); no staleness handling.
- The shared Apache AGE graph is cleaned vertex-by-vertex rather than dropped/recreated; workspace isolation of the AGE graph remains a future improvement.

### Phase 7
- **Bug found by browser verification (fixed)**: the sync plugin resolved the workspace once at server boot and gave up permanently when none existed — on a fresh install (signup happens AFTER boot) folder sync never started until a server restart. Extracted `server/lib/sync/daemon.ts` (`createSyncDaemon`) with lazy boot: the daemon stays subscribed to synced-folder events and boots when the first Synced Folder is added. Covered by `test/e2e/sync-daemon.spec.ts` (2 tests). Full suite: **86 files / 665 tests passed**.
- Dev-server note: the better-auth client derives its base URL from `public.siteUrl` (default `http://localhost:3000`); when running on a non-default port set `NUXT_PUBLIC_SITE_URL` or signup/login posts hit the wrong origin.

## Deferred / open

- **Merged-tree folder path-collision quirk.** Two Synced Folders with overlapping relative paths share a `folders` row and the notes UI merges them. Either per-synced-folder `folders` rows or root-prefix rendering in the UI is needed.
- **Stale embeddings on surviving concepts.** A Concept that survives orphan GC keeps its embedding/description. If the surviving mention set changes meaningfully, the embedding may become stale; no backfill or re-embed trigger exists.
- **Pipeline raw-BullMQ test divergence.** The ingestion pipeline uses raw BullMQ instead of the `@base/jobs` `ApplicationJob` abstraction, so tests stub `ingestNote` directly rather than using the `queue` fixture.
- **Rebuild / danger-zone interplay.** `POST /api/settings/rebuild` truncates graph-derived relational rows and recreates the shared AGE graph; it intentionally does not touch synced-folder config. Rebuild does not re-trigger onboarding state because config is not derived data.
- **i18n `my-locale` coverage.** Wizard keys were added to `en.json`; `my.json` coverage is incomplete.
- **Env source reporting.** Effective env-derived LLM values are reported as `source: 'default'`. A separate `'env'` source would be more honest but would require changing the two-source contract in settings responses.

## Wayfinder record

- `ticket-synced-folder-data-model.md` — closed 2026-07-30: `notes` gets `synced_folder_id`, composite uniqueness, backfill + fallback trigger, `folders` left workspace-scoped, path edits = remove + re-add.
- `ticket-wizard-mode-ux-options.md` — closed 2026-07-30: single-page wizard on `/settings`, three-step progress, Redis hard-block, steady-state fallback, first-run `/chat` card.
- `ticket-smoke-test-note-flow.md` — closed 2026-07-31: `__aso-smoke-test.md`, `POST/GET /api/onboarding/smoke-test`, 7-phase state machine, 3-min timeout, 409 prerequisites, retry/re-verify semantics.
- `ticket-embedding-dims-detection.md` — closed 2026-07-30: probe-always for both providers, accept iff 2048; full findings in `research-embedding-dims.md`.
- `ticket-orphan-gc-rules.md` — closed 2026-07-30: inline transaction, cascade notes + derived rows, shared rows survive, user tags/dismissals deleted with notes, `REMOVE` confirm UI.
- `ticket-author-plan-007.md` — closed 2026-07-30: this final spec assembled from the above.
