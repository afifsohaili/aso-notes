# Plan 004 — Extraction Observability

Status: Phase 1 (O1–O4) done. Phase 2 (O5–O7) planned.
Created: 2026-07-29. Phase 2 added: 2026-07-30.

## Phase 2 — Queue & Sweeper Observability

### Problem

After a rebuild, every note sits at `status='pending'` and the user cannot tell:

- which notes are **settling** (changed <5 min ago, sweeper ignores them),
- which are **queued** in BullMQ waiting for a worker,
- which are **actively processing** right now (worker concurrency 2),
- whether the **sweeper ran at all** (its only output is a console log).

`pending` conflates three real states. Queue state lives only in Redis; nothing surfaces it in-app.

### Decisions (locked with user, 2026-07-30)

1. **Scope: live queue status API + note status expansion + sweeper heartbeat** (options A+B+C). bull-board rejected (overkill for one queue, separate UI, doesn't fix per-note ambiguity).
2. **Status expansion: `pending → queued → processing → ingested/failed`.**
   - Fast-path upsert stays `pending` (= "settling").
   - Dispatcher flips to `queued` after successful enqueue.
   - Worker flips to `processing` when `ingestNote` starts (inline/manual runs flip too).
   - store-graph success → `ingested`; failure → `failed` (unchanged).
3. **Stale handling:**
   - `queued`: sweeper re-dispatches queued notes whose `updated_at` is older than the settle interval; BullMQ jobId = noteId makes re-add a dedup no-op when the job still exists (covers Redis flush / orphaned queue rows).
   - `processing`: rely on BullMQ stalled-job recovery (stalled jobs are retried automatically); worker `failed` event flips the note to `failed` when the job gives up (covers worker crash mid-run).
4. **Queue status API:** `GET /api/ingestion/status` → BullMQ `getJobCounts()` + active jobs resolved to note paths + sweeper heartbeat. `queue: null` when Redis is not configured.
5. **Sweeper heartbeat:** in-memory module singleton (last sweep time + dispatched count). Single-process assumption documented; not persisted (30s writes would be noise).
6. **UI:** per-note badges in the note list (queued, processing) + **a new queue page** (`/notes/queue`) showing queue counts, active jobs, queued list, settling list, last sweep time, auto-refresh. Navbar link.
   - **Amendment to Phase-1 decision 5** ("viewing: note UI only, no new page"): user explicitly requested a dedicated queue page on 2026-07-30.

### Parts changing

- **Migration:** extend `notes.status` check constraint with `queued`, `processing`; types + schema dump.
- **`sync/dispatcher.ts`:** BullMQ dispatcher flips note `pending→queued` post-enqueue; `jobId = noteId` on `queue.add` for dedup.
- **`sync/sweeper.ts`:** also selects stale `queued` notes for re-dispatch; records heartbeat into a new `sync/sweeper-state.ts` module singleton.
- **`sync/ingest.ts` / `plugins/ingestion-worker.ts`:** flip to `processing` at run start; worker `failed` handler flips `queued/processing → failed`.
- **Retry/process endpoints:** unchanged flow — dispatcher/ingest transitions cover them.
- **`server/api/ingestion/status.get.ts` (new):** queue counts (BullMQ), active jobs → note paths, sweeper heartbeat. No Redis → `queue: null` (DB-derived sections still work).
- **UI:** `note-list.vue` badges for `queued`/`processing`; new `pages/notes/queue.vue` (counts, active, queued, settling, last sweep, 3–5s poll); navbar link.
- **`GET /api/notes/status-counts`:** extended with `queued`/`processing` counts (feeds settings danger zone + queue page).

### Build order

- [x] **O5** — Schema + transitions: status enum expansion, dispatcher/worker flips, jobId dedup, worker failed-handler flip, sweeper stale re-dispatch + heartbeat module. **DONE 2026-07-30**
- [x] **O6** — `GET /api/ingestion/status` + extended status-counts. **DONE 2026-07-30**
- [x] **O7** — UI: note-list badges + `/notes/queue` page + navbar link. **DONE 2026-07-30**

Each milestone: TDD (feature specs at the boundary: dispatch → status flip; worker start → processing; status endpoint input→body), update this doc with status + divergences, commit.

---

## Phase 1 — Ingestion Run capture (Last Run)

### Problem

No observability into ingestion/extraction:

- `notes` has `status ∈ {pending, ingested, failed}` but **no error column** (`ingest.ts` comment: "failures are logged and visible via BullMQ failed-job retention").
- Errors live only in BullMQ failed jobs (Redis, 7-day retention) and `console.error` process logs — invisible in-app.
- No record of which **stage** failed (7 stages per pipeline), no timing, no token usage, no visibility into what the LLM saw (prompt) or returned (raw extraction JSON), no record of which vocabulary strategy ran.

### Decisions (locked with user, 2026-07-29)

1. **Storage: `notes.last_run` jsonb, latest run only.** No runs table, no history, no archival. Every ingestion overwrites. Rationale: user explicitly accepts losing past failures; doesn't want to deal with archival volume.
2. **Granularity: run-level + `failed_stage` name.** No per-stage child records.
3. **Capture: full prompt + response, verbatim, no size cap.** Plus token usage, model, vocabulary strategy, duration, extraction counts.
4. **Record on success too** — token/strategy observability on healthy notes, supports plan-003 M7 strategy comparison (current state per note).
5. **Viewing: note UI only** — error badge + expandable Last Run panel. No new page.
6. **Rejected:** extraction_runs table, per-stage rows, outbox table, external observability stack (OTel/Sentry), prompt hashing/truncation.

### Data model

Migration adds: `notes.last_run jsonb NULL`.

Fixed schema (validated in code with zod; TS type in `server/lib/pipeline/last-run.ts`):

```ts
interface LastRun {
  pipeline: string                    // e.g. 'markdown-note-with-links'
  status: 'succeeded' | 'failed'
  failed_stage: string | null         // stage id that threw, e.g. 'extract-graph'
  error: { name: string, message: string, stack?: string } | null
  attempt: number                     // BullMQ attemptsMade (1-based); 0 when inline/manual
  job_id: string | null               // BullMQ job id when queued
  started_at: string                  // ISO
  finished_at: string                 // ISO
  duration_ms: number
  chunks: number | null               // chunk count produced
  extraction: {
    strategy: string                  // 'full' | 'top-k' | 'blind-merge'
    model: string
    messages: { role: string, content: string }[]   // full prompt, verbatim
    response: string                  // raw LLM response body, verbatim
    usage: { prompt_tokens: number, completion_tokens: number } | null
    counts: { concepts: number, relations: number, mentions: number, tags: number }
  } | null                            // null when run failed before extract-graph
}
```

`last_run` is `NULL` until the first ingestion attempt completes (success or failure).

### Parts changing

#### Pipeline capture (`server/lib/pipeline/`)

- **`context.ts`**: `PipelineContext` accumulates run data — `startedAt`, `currentStage`, `chunks` count, `extraction` payload slot.
- **`run-pipeline.ts`**: tracks `ctx.currentStage = stageId` before each invoke (this is how `failed_stage` is known). Measures total duration.
- **`stages/extract-graph.ts`**: records into ctx — strategy id, model, messages sent, raw response text, usage, parsed counts.
- **LLM provider interface** (`server/lib/ai/registry.ts` + providers): `complete()` must surface token usage. OpenRouter returns `usage`; extend return type to `{ content, usage? }`. Update callers. If a provider can't supply usage → `null`.
- **`stages/store-graph.ts`**: unchanged (status flip stays there).

#### Run record write (`server/lib/sync/ingest.ts`)

- On success: after `runPipeline` resolves, build LastRun from ctx, `UPDATE notes SET last_run = ...`. Written outside the store-graph transaction (post-commit) — accepted risk: crash between commit and write loses the success record (status is still correct); documented, not handled.
- On failure: build LastRun with `failed_stage` from ctx + serialized error, write `last_run` alongside `status='failed'`, rethrow for BullMQ retry. Each retry attempt overwrites (latest-only semantics — accepted).
- Worker (`server/plugins/ingestion-worker.ts`): pass BullMQ `attemptsMade` + job id through to `ingestNote`.

#### API

- Notes endpoints (`server/api/notes/`) include `last_run` in note serialization. `last_run` can be large (full prompt) — note list endpoint returns it **without** `extraction.messages`/`response` (summary fields only); full payload only on single-note endpoint.

#### UI (note UI only, no new page)

- Note list: failed notes show error badge with `last_run.error.message` (replaces/augments current retry-only affordance).
- Note detail: expandable "Last Run" panel — status, failed stage, duration, tokens, strategy, model, counts, collapsible prompt/response viewers (`<pre>`, response pretty-printed when valid JSON).
- Tailwind only; i18n keys under `notes.lastRun.*`.

### Build order

- [x] **O1** — Migration (`notes.last_run` jsonb) + types.d.ts + schema dump + schema/TS type + schema test. **DONE 2026-07-29**
- [x] **O2** — Pipeline capture: context accumulation, run-pipeline stage tracking, extract-graph payload capture, LLM usage surface. **DONE 2026-07-29**
- [x] **O3** — `ingest.ts` success/failure LastRun writes + worker attempt/job-id plumbing. **DONE 2026-07-29**
- [x] **O4** — Notes API serialization (list=summary, detail=full) + note UI badge/panel. **DONE 2026-07-29**

Each milestone: TDD (feature specs: ingest a note → verify `last_run` row content; failure case → verify `failed_stage` + error), update this doc with status + divergences, commit.

#### O1 implementation notes

- Migration `1785200000001_add_last_run_to_notes.ts` adds `notes.last_run jsonb NULL` (no default).
- Regenerated `packages/shared/types.d.ts` and `apps/web/db/schema.sql` via `pnpm db:migrate:generate` / `pnpm db:schema:dump`.
- Created `server/lib/pipeline/last-run.ts` with the exact `LastRun` interface and a hand-rolled `parseLastRun(json)` validator returning `null` on invalid/missing input.
- **Divergence from plan:** the repo does not depend on zod and no validation library is present, so O1 uses a hand-rolled validator instead of adding a zod dependency. The interface and validation semantics match the fixed schema in the plan.
- Tests:
  - `test/e2e/notes-schema.spec.ts`: asserts `last_run` column exists, is nullable, and accepts a valid JSONB round-trip.
  - `test/unit/last-run.spec.ts`: covers `parseLastRun` — valid full record, null/garbage/missing fields, `extraction: null`, status enum, `error: null` on success, and invalid nested shapes.
- Full suite: 419 passed / 4 skipped; lint clean.

#### O2 implementation notes

- `server/lib/pipeline/context.ts`: added `startedAt` (set in constructor and overwritten by `runPipeline` at run start), `currentStage`, `chunksCount`, and `extractionRecord: LastRun['extraction'] | null` for accumulation.
- `server/lib/pipeline/run-pipeline.ts`: sets `ctx.startedAt = new Date()` at run start and `ctx.currentStage = stageId` before each stage invoke, so the failing stage id is observable on failure.
- `server/lib/pipeline/stages/chunk-markdown-aware.ts`: records `ctx.chunksCount = ctx.chunks.length` after chunking.
- `server/lib/pipeline/stages/extract-graph.ts`: captures the strategy id, model, verbatim system+user messages, raw LLM response text, token usage, and parsed counts on `ctx.extractionRecord`.
- `server/lib/ai/types.ts`: `CompletionResult` already exposed `usage`; added optional `model` so callers (extract-graph) can record which model answered without plumbing model through the constructor.
- `server/lib/ai/openrouter-llm.ts` / `ollama.ts`: both now return `model` in `CompletionResult`; usage was already surfaced, Ollama returns `null` when its response lacks eval counts.
- Tests:
  - `test/unit/pipeline-framework.spec.ts`: context defaults + runPipeline `startedAt`/`currentStage` assertions.
  - `test/unit/chunk-markdown-aware-stage.spec.ts`: chunk count accumulation.
  - `test/unit/extract-graph-stage.spec.ts`: extraction payload (messages, response, usage, model, counts) recorded on ctx.
  - `test/e2e/pipeline-runner.spec.ts`: end-to-end pipeline with real chunk + extract stages, asserting `currentStage`, `chunksCount`, and full extraction payload.
- Full suite: 425 passed / 4 skipped; lint clean.
- **Divergence from plan:** `PipelineContext` names the capture slot `extractionRecord` (not `extraction`) to avoid shadowing the existing parsed `ctx.extraction: GraphExtraction`. The model is returned from `complete()` rather than threading it through `ExtractGraphStage`'s constructor, which keeps the provider interface as the seam and avoids changing `createStageRegistry`.

#### O3 implementation notes

- `server/lib/pipeline/last-run.ts`: added `buildLastRun(ctx, options)` helper and `serializeError` to turn a completed/failed run into a validated `LastRun` object. It records `status` ('succeeded'/'failed'), `failed_stage` (current stage on failure), `error` (Error → name/message/stack; non-Error → `Error`/`String(e)`), `attempt`/`job_id` from optional worker metadata, timing, chunks count, and the extraction payload.
- `server/lib/sync/ingest.ts`: `ingestNote` now creates the `PipelineContext` before the try/catch so the catch path can build a failure record. After `runPipeline` succeeds it writes `last_run` to the notes row (the status flip is already committed by `store-graph`). On failure it writes `status='failed'` and `last_run` before rethrowing, so every completed run leaves a record even when a stage throws mid-pipeline. The success record is written after the pipeline returns, outside the store-graph transaction, matching the accepted crash-gap trade-off in the plan.
- `server/plugins/ingestion-worker.ts`: the BullMQ worker passes `attemptsMade` and `job.id` through as `worker` metadata; manual/API callers (inline dispatcher, `process.post`, `retry.post`) leave `worker` undefined, so `attempt` is 0 and `job_id` is null.
- `server/lib/sync/process.ts`, `server/api/notes/process.post.ts`, `server/api/notes/retry.post.ts`: unchanged — they flow through the dispatcher and never construct a `worker` object, so their runs record `attempt: 0` / `job_id: null`.
- Tests:
  - `test/unit/last-run-assembly.spec.ts` (new): `buildLastRun` edge cases — success/failure shape, non-Error throws, missing extraction, worker metadata, non-negative duration.
  - `test/e2e/ingest-graph.spec.ts`: added success last_run assertions (status, pipeline, chunks, duration, extraction payload); extended the LLM-failure and store-graph-atomicity tests to assert `last_run.status='failed'`, failing stage, error shape, and extraction null vs. present; added a worker test that passes `attemptsMade`/`jobId` and asserts they are recorded.
- Full suite: 433 passed / 4 skipped; lint clean.
- **Divergences from plan:**
  - The stored status value is `'succeeded'` (matching the existing `LastRun` enum and validator), not `'success'` as used in the prompt.
  - Note path/title/content_hash are **not** duplicated inside `last_run` because the fixed `LastRun` schema does not include them; they remain available on the `notes` row.
  - The worker plumbing uses the BullMQ field names `attemptsMade`/`jobId` internally and maps them to the `LastRun` fields `attempt`/`job_id` at write time.

#### O4 implementation notes

- `server/lib/pipeline/last-run.ts`: added `LastRunSummary` type and `toLastRunSummary(lastRun)` helper that copies every top-level field and the extraction meta (`strategy`, `model`, `usage`, `counts`) while stripping `messages` and `response` for the list payload.
- `server/api/notes/index.get.ts`: selects `last_run`, validates it with `parseLastRun`, and returns `lastRun` as a summary on every note. Malformed stored JSON serializes as `null`; missing `last_run` also returns `null`.
- `server/api/notes/[...slug].ts`: the existing single-note GET route now selects `last_run`, validates it, and returns the full `LastRun` object (including `messages` and `response`) as `lastRun`.
- `app/components/notes/note-list.vue`: `NoteListItem` now includes a minimal `lastRun` shape. Failed notes show an inline error badge (`ExclamationTriangleIcon`) using `lastRun.error.message` when available, falling back to a generic tooltip; the badge is also shown when `note.status === 'failed'` even if `lastRun` is absent.
- `app/components/notes/note-detail.vue`: `NoteDetailNote` now includes the full `LastRun` shape. A collapsed-by-default "Last Run" panel (`<details>`) shows status, pipeline, failed stage, duration, chunks, extraction meta (strategy, model, token usage, concept/relation/mention/tag counts), and toggles for the full prompt messages and pretty-printed raw response. Tailwind only, no inline styles, heroicons only, i18n keys under `notes.lastRun.*`.
- `app/pages/notes/index.vue`: no changes needed; the existing fetch types and pass-through already carry the new `lastRun` field.
- Tests:
  - `test/unit/last-run-summary.spec.ts` (new): summary serializer keeps top-level fields + extraction meta, strips messages/response, preserves null extraction, preserves failed/error fields, does not mutate input.
  - `test/e2e/notes-api.spec.ts`: added list summary test (no messages/response), detail full test (messages + response verbatim), malformed `last_run` returns `null` on both endpoints, and no-`last_run` returns `null`.
  - `test/components/note-list-retry.nuxt.spec.ts`: added error badge tests for failed notes with/without `last_run`.
  - `test/components/note-detail.nuxt.spec.ts`: added badge rendering, extraction meta, and messages/response toggle tests.
- Full suite: 446 passed / 4 skipped; lint clean.
- **Divergences from plan:**
  - The list summary strips `extraction.messages` and `extraction.response`; there is no separate `rawResponse` field in the stored schema.
  - The inner messages/response viewers use toggle buttons (`v-if`) rather than nested `<details>` elements, while the outer panel remains a native `<details>` collapsed by default.
  - Count labels are rendered as plain text (e.g. "3 concepts, 2 relations...") instead of a structured table.

#### O5 implementation notes

- **Migration:** `1785200000002_add_queued_processing_status_to_notes.ts` drops and recreates `notes_status_check` to include `queued` and `processing`. Regenerated `packages/shared/types.d.ts` and `apps/web/db/schema.sql` via `pnpm db:migrate:generate` / `pnpm db:schema:dump`.
- **Dispatcher:** `server/lib/sync/dispatcher.ts` now requires `db` to flip `pending → queued` after a successful enqueue (BullMQ) or before the inline run. The BullMQ dispatcher uses `queue.add(..., { jobId: noteId })` for dedup; the update is guarded to `status IN ('pending', 'queued')` so an ingested/failed row is never rolled backwards. A queue failure leaves the note `pending`.
- **Inline / no-Redis path:** `notes-sync.ts` and `server/lib/sync/process.ts` pass `db` into `createSyncDispatcher`. The inline dispatcher performs the same `pending → queued` flip so tests and the no-Redis path see the same state machine.
- **Ingest run start:** `server/lib/sync/ingest.ts` flips `queued/pending → processing` at the start of `ingestNote`, guarded by `status IN ('queued', 'pending')`. This covers the normal BullMQ path (`queued`), inline/test paths (`pending`), and direct manual calls, while preventing a stale job from overwriting `ingested`/`failed`.
- **Worker failed handler:** `server/lib/sync/worker-failed.ts` holds `handleFailedIngestionJob`; the plugin's `worker.on('failed')` calls it with the DB from `useDatabase`. The update is guarded to `status IN ('queued', 'processing')` so it cannot clobber a row that just succeeded. The catch block in `ingestNote` already records `last_run` and flips `failed` for in-handler errors; the event handler covers crashes and stalled-job exhaustion.
- **Sweeper stale re-dispatch:** `server/lib/sync/sweeper.ts` `settledPendingNotesQuery` now selects `status IN ('pending', 'queued')` with `updated_at < now() - 5 minutes`. `processing` is intentionally excluded (BullMQ stalled recovery owns it). `runSweeperOnce` records the heartbeat.
- **Heartbeat:** `server/lib/sync/sweeper-state.ts` is an in-memory singleton with `lastSweepAt`, `lastDispatched` (count), `lastFailed` (count), plus `resetSweeperState()` for tests. Single-process assumption is documented; a multi-process deployment would need a shared store.
- **Tests:**
  - `test/e2e/notes-schema.spec.ts`: updated status-constraint test to accept `queued`/`processing` and reject bogus.
  - `test/e2e/notes-sweeper.spec.ts`: updated call sites to the new `createInlineDispatcher` signature; added stale-queued re-dispatch, fresh-queued skip, processing skip, and heartbeat assertions.
  - `test/unit/notes-sync.spec.ts`: updated `createSyncDispatcher` and `settledPendingNotesQuery` expectations for the new signatures and SQL shape.
  - `test/e2e/notes-dispatcher.spec.ts` (new): BullMQ enqueue with `jobId=noteId`, `pending → queued`, re-dispatch of stale queued, no backwards roll on ingested, enqueue failure leaves `pending`, inline flip before run.
  - `test/e2e/notes-worker-failed.spec.ts` (new): `queued → failed`, `processing → failed`, guarded against `pending`/`ingested`, no-op for missing/undefined ids.
- **Status-counts API:** intentionally left at the old three-value shape (`pending`, `ingested`, `failed`) for O6; no existing tests broke because the sweeper/ingest tests observe the DB directly.
- **Domain glossary:** added `Note Status` to `notes/aso-notes/CONTEXT.md`.
- Full suite: 473 passed / 4 skipped; lint clean.
- **Divergences from plan:**
  - The dispatcher update is `status IN ('pending', 'queued')` rather than strictly `status='pending'` so a stale-queued re-dispatch refreshes `updated_at` and avoids immediate re-dispatch loops.
  - The failed-handler logic was extracted to `server/lib/sync/worker-failed.ts` so it can be tested without importing the Nitro plugin module (which relies on `defineNitroPlugin`/`useWorker` auto-imports).

#### O6 implementation notes

- **Response shape:** `GET /api/ingestion/status` returns a flat, typed payload:
  ```ts
  {
    db: { pending, queued, processing, ingested, failed },
    queue: { waiting, active, completed, failed, delayed } | null,
    activeJobs: [{ id, path, title }],
    sweeper: { lastSweepAt, lastDispatched, lastFailed }
  }
  ```
- **Queue accessor:** new `server/lib/sync/queue.ts` wraps `useQueue` with a small `IngestionQueueSnapshot` interface (`getJobCounts`, `getActiveJobs`). It returns `null` when `NUXT_REDIS_URL` is unset, and exposes `setIngestionQueueOverride` / `clearIngestionQueueOverride` so tests can inject a fake queue without Redis.
- **Status builder:** `server/lib/sync/ingestion-status.ts` holds the pure `buildIngestionStatus({ db, workspaceId, queue, sweeperState })` function used by the endpoint. It reads DB counts, resolves active job ids to note paths scoped to the workspace, and copies the sweeper heartbeat.
- **Endpoint:** `server/api/ingestion/status.get.ts` follows the auth + workspace resolution pattern of `settings/rebuild.post.ts` and `notes/status-counts.get.ts`.
- **No-Redis graceful path:** when `NUXT_REDIS_URL` is unset and no override is active, the endpoint returns `queue: null` and `activeJobs: []` without throwing.
- **Status-counts extension:** `GET /api/notes/status-counts` now returns `{ pending, queued, processing, ingested, failed }`. Its e2e test and the `settings-page` component mock were updated to include the new counts.
- **Tests:**
  - `test/e2e/ingestion-status.get.spec.ts` (new): feature spec — seeds notes in all statuses, overrides the queue snapshot, asserts DB counts, queue counts, active job mapping, and heartbeat shape. Also verifies the no-Redis path returns `queue: null` and `activeJobs: []`.
  - `test/e2e/ingestion-status.unit.spec.ts` (new): unit-style edge cases for `buildIngestionStatus` — zero counts, workspace scoping, queue counts + active job mapping, skipping jobs from other workspaces, skipping missing note ids, heartbeat passthrough. Runs in the `e2e` project because it needs the transactional DB fixture.
  - `test/e2e/settings-rebuild.spec.ts`: updated status-counts assertions to include `queued`/`processing`.
  - `test/components/settings-page.nuxt.spec.ts`: updated status-counts mock.
- Full suite: e2e 216 passed, unit 236 passed, nuxt 28 passed; lint clean. (The first full `pnpm test` run showed one flaky `notes-watcher.spec.ts` failure that passes when run alone; unrelated to O6.)
- **Divergence from plan:** The "fake/inline" queue testing fixture from `@base/testing` is built around the `@base/jobs` abstraction, while the ingestion pipeline uses BullMQ directly via `useQueue`. O6 therefore uses a dedicated `IngestionQueueSnapshot` fake override in `server/lib/sync/queue.ts` rather than the generic `@base/testing` queue fixture. The fake queue behavior is still verified in the feature spec.
- **Active-job resolution policy:** active jobs whose note id cannot be resolved to a note in the caller's workspace are silently skipped. This prevents leaking other workspaces' paths and matches the endpoint's workspace-scoped boundary.

#### O7 implementation notes

- New page `app/pages/notes/queue.vue` polls `GET /api/ingestion/status` every 3 seconds via a `setInterval` refresh of `useFetch`, cleared on unmounted.
- Page layout:
  - **Database status** row: counts for `pending`, `queued`, `processing`, `ingested`, `failed`.
  - **Queue status** row: `waiting`, `active`, `completed`, `failed`, `delayed` from BullMQ; or a "Queue unavailable (no Redis)" state when the endpoint returns `queue: null`.
  - **Active jobs** list: job title (or path) + a `NuxtLink` to `/notes?note=<encoded path>` so the note detail opens in the existing notes page.
  - **Sweeper heartbeat**: last-sweep relative time plus dispatched/failed counts from the last sweep.
- `app/components/notes/note-list.vue` badge map extended for `queued` (blue) and `processing` (indigo + `animate-pulse`); status text now translated via `notes.status.*` i18n keys.
- `app/components/app-header.vue` gained a `/notes/queue` nav link with `heroicons/queue-list` icon, placed between Notes and Graph.
- Component tests:
  - `test/components/queue-page.nuxt.spec.ts`: DB/queue counts, queue-null state, active-job links, heartbeat, and 3-second polling.
  - `test/components/note-list-retry.nuxt.spec.ts`: added queued/processing badge render test.
  - `test/components/app-header.nuxt.spec.ts`: updated signed-out + signed-in link assertions to include `/notes/queue`.
- All labels use explicit `useI18n` imports and keys added to `locales/en.json`.
- Full suite: 489 passed / 4 skipped; lint clean.
- **Divergences from plan:**
  - The queue page uses a simple in-component relative-time helper (minutes/hours/just now) rather than adding a date library, so the heartbeat is readable without a new dependency. The helper recomputes on each poll refresh.
  - The DB and queue count rows are rendered as computed card arrays to avoid template-level type gymnastics against the `IngestionStatusResponse` interface.

- Run history / archival (rejected by user — latest-only is the design).
- Per-stage timing rows.
- Outbox table (current sweeper + pending status remains the relay).
- Prompt truncation/capping.
- Strategy comparison view (M7 does it ad-hoc from `last_run.strategy` + spot checks).
