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

## Tickets

<!-- frontier = open + unblocked + unclaimed. Resolve ONE per session (research tickets excepted). -->

- [Synced Folder data model](ticket-synced-folder-data-model.md) — grilling
- [Wizard-mode UX options](ticket-wizard-mode-ux-options.md) — prototype
- [Smoke-test note flow](ticket-smoke-test-note-flow.md) — grilling
- ~~[Embedding dims detection](ticket-embedding-dims-detection.md)~~ — research — **CLOSED 2026-07-30** (see Decisions so far)
- [Orphan GC rules](ticket-orphan-gc-rules.md) — grilling (blocked by Synced Folder data model)
- [Author plan-007](ticket-author-plan-007.md) — task (blocked by all above)

## Not yet specified

- Legacy org→workspace cleanup onboarding forces: signup auto-provisioning of the workspace, redirect into the wizard, the pending `organizations`→`workspaces` migration touchpoints (product.md decision 2/14).
- Post-clean-break env surface: which `NUXT_*` vars remain (DB, Redis, LLM API keys, auth), `.env.example` and README rewrite.
- Danger-zone interplay: the rebuild button must not touch synced-folder config; does rebuild re-trigger onboarding state? (Suspected: no — config is not derived data.)
- Test strategy for the gated wizard: the mandatory e2e proof needs queue + LLM, awkward in the transactional harness — likely stubbed boundaries, but the shape isn't sharp yet.
- i18n key layout for all new wizard UI (mechanical, but large).

## Out of scope

- Multi-user workspaces, sharing, per-user synced folders beyond the single-tenant MVP.
- Non-Markdown ingestion (YAML/PDF/Excalidraw) — deferred in plan-003, unchanged.
- Arbitrary embedding dimensions / `halfvec(2048)` schema migration.
- Server-side directory browser for folder picking (free-text absolute path + validation is the decision).

## Implementation log

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
