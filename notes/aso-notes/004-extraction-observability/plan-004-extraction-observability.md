# Plan 004 — Extraction Observability (Last Run)

Status: O1 and O2 done, O3 and O4 pending.
Created: 2026-07-29.

## Problem

No observability into ingestion/extraction:

- `notes` has `status ∈ {pending, ingested, failed}` but **no error column** (`ingest.ts` comment: "failures are logged and visible via BullMQ failed-job retention").
- Errors live only in BullMQ failed jobs (Redis, 7-day retention) and `console.error` process logs — invisible in-app.
- No record of which **stage** failed (7 stages per pipeline), no timing, no token usage, no visibility into what the LLM saw (prompt) or returned (raw extraction JSON), no record of which vocabulary strategy ran.

## Decisions (locked with user, 2026-07-29)

1. **Storage: `notes.last_run` jsonb, latest run only.** No runs table, no history, no archival. Every ingestion overwrites. Rationale: user explicitly accepts losing past failures; doesn't want to deal with archival volume.
2. **Granularity: run-level + `failed_stage` name.** No per-stage child records.
3. **Capture: full prompt + response, verbatim, no size cap.** Plus token usage, model, vocabulary strategy, duration, extraction counts.
4. **Record on success too** — token/strategy observability on healthy notes, supports plan-003 M7 strategy comparison (current state per note).
5. **Viewing: note UI only** — error badge + expandable Last Run panel. No new page.
6. **Rejected:** extraction_runs table, per-stage rows, outbox table, external observability stack (OTel/Sentry), prompt hashing/truncation.

## Data model

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

## Parts changing

### Pipeline capture (`server/lib/pipeline/`)

- **`context.ts`**: `PipelineContext` accumulates run data — `startedAt`, `currentStage`, `chunks` count, `extraction` payload slot.
- **`run-pipeline.ts`**: tracks `ctx.currentStage = stageId` before each invoke (this is how `failed_stage` is known). Measures total duration.
- **`stages/extract-graph.ts`**: records into ctx — strategy id, model, messages sent, raw response text, usage, parsed counts.
- **LLM provider interface** (`server/lib/ai/registry.ts` + providers): `complete()` must surface token usage. OpenRouter returns `usage`; extend return type to `{ content, usage? }`. Update callers. If a provider can't supply usage → `null`.
- **`stages/store-graph.ts`**: unchanged (status flip stays there).

### Run record write (`server/lib/sync/ingest.ts`)

- On success: after `runPipeline` resolves, build LastRun from ctx, `UPDATE notes SET last_run = ...`. Written outside the store-graph transaction (post-commit) — accepted risk: crash between commit and write loses the success record (status is still correct); documented, not handled.
- On failure: build LastRun with `failed_stage` from ctx + serialized error, write `last_run` alongside `status='failed'`, rethrow for BullMQ retry. Each retry attempt overwrites (latest-only semantics — accepted).
- Worker (`server/plugins/ingestion-worker.ts`): pass BullMQ `attemptsMade` + job id through to `ingestNote`.

### API

- Notes endpoints (`server/api/notes/`) include `last_run` in note serialization. `last_run` can be large (full prompt) — note list endpoint returns it **without** `extraction.messages`/`response` (summary fields only); full payload only on single-note endpoint.

### UI (note UI only, no new page)

- Note list: failed notes show error badge with `last_run.error.message` (replaces/augments current retry-only affordance).
- Note detail: expandable "Last Run" panel — status, failed stage, duration, tokens, strategy, model, counts, collapsible prompt/response viewers (`<pre>`, response pretty-printed when valid JSON).
- Tailwind only; i18n keys under `notes.lastRun.*`.

## Build order

- [x] **O1** — Migration (`notes.last_run` jsonb) + types.d.ts + schema dump + schema/TS type + schema test. **DONE 2026-07-29**
- [x] **O2** — Pipeline capture: context accumulation, run-pipeline stage tracking, extract-graph payload capture, LLM usage surface. **DONE 2026-07-29**
- [x] **O3** — `ingest.ts` success/failure LastRun writes + worker attempt/job-id plumbing. **DONE 2026-07-29**
- **O4** — Notes API serialization (list=summary, detail=full) + note UI badge/panel.

Each milestone: TDD (feature specs: ingest a note → verify `last_run` row content; failure case → verify `failed_stage` + error), update this doc with status + divergences, commit.

### O1 implementation notes

- Migration `1785200000001_add_last_run_to_notes.ts` adds `notes.last_run jsonb NULL` (no default).
- Regenerated `packages/shared/types.d.ts` and `apps/web/db/schema.sql` via `pnpm db:migrate:generate` / `pnpm db:schema:dump`.
- Created `server/lib/pipeline/last-run.ts` with the exact `LastRun` interface and a hand-rolled `parseLastRun(json)` validator returning `null` on invalid/missing input.
- **Divergence from plan:** the repo does not depend on zod and no validation library is present, so O1 uses a hand-rolled validator instead of adding a zod dependency. The interface and validation semantics match the fixed schema in the plan.
- Tests:
  - `test/e2e/notes-schema.spec.ts`: asserts `last_run` column exists, is nullable, and accepts a valid JSONB round-trip.
  - `test/unit/last-run.spec.ts`: covers `parseLastRun` — valid full record, null/garbage/missing fields, `extraction: null`, status enum, `error: null` on success, and invalid nested shapes.
- Full suite: 419 passed / 4 skipped; lint clean.

### O2 implementation notes

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

### O3 implementation notes

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

## Deferred / rejected

- Run history / archival (rejected by user — latest-only is the design).
- Per-stage timing rows.
- Outbox table (current sweeper + pending status remains the relay).
- Prompt truncation/capping.
- Strategy comparison view (M7 does it ad-hoc from `last_run.strategy` + spot checks).
