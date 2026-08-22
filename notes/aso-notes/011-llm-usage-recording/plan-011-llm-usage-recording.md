# Plan: LLM Usage Recording & Tracing (011)

## Phase 1 — Trace data model schema (done)

### Built

- Migration `apps/web/migrations/20260806000003_llm_tracing_schema.ts` creates:
  - `llm_traces`: workspace-scoped, polymorphic owner (`owner_type` + `owner_id`), `kind` (`ingestion` | `chat` | `consolidation`), `status`, timestamps, error.
  - `llm_generations`: FK to trace, `seq`, use case, provider/model, nullable inline JSONB `prompt`/`response`, token counts, `cost_usd numeric(12,6)`, latency, finish reason, error, `pruned_at`.
  - `llm_tool_calls`: FK to trace, `seq`, name, JSONB input/output, duration, status, `pruned_at`.
  - Adds `messages.trace_id` nullable plain uuid with index `idx_messages_trace_id`.
- Indexes:
  - `llm_traces_workspace_id_owner_lookup_idx` (workspace_id, owner_type, owner_id)
  - `llm_traces_status_started_at_idx`
  - `llm_generations_trace_id_seq_idx` and partial `llm_generations_pruned_at_idx WHERE pruned_at IS NULL`
  - `llm_tool_calls_trace_id_seq_idx` and partial `llm_tool_calls_pruned_at_idx WHERE pruned_at IS NULL`
- All three tables cascade on workspace delete; children cascade on trace delete.
- `notes.last_run` is already JSONB — no schema change needed; trace pointer will live inside the JSONB later.

### Regenerated artifacts

- `apps/web/db/schema.sql` dumped via `pnpm --filter web db:schema:dump`.
- `packages/shared/types.d.ts` updated with `LlmTraces`, `LlmGenerations`, `LlmToolCalls`, and `messages.trace_id`.

### Tests

- `apps/web/test/e2e/llm-tracing-schema.spec.ts` (8 tests, e2e project):
  - tables and columns match spec
  - `messages.trace_id` is nullable and indexed
  - round-trip insert through Kysely + generated types
  - nullable content columns accept null
  - `seq` ordering works
  - trace delete cascade-deletes children
  - workspace delete cascade-deletes all tracing rows while preserving other workspaces
  - `messages.trace_id` can be set and read back

### Divergences from plan/map

- `llm_traces` adds `aborted` to the `status` enum in the migration comment (map listed `running` | `completed` | `failed`; ticket-trace-data-model omitted `aborted` but agent-chat tracing ticket requires it). Schema stores it as plain varchar, so no CHECK constraint; comment documents the expected values.
- The migration adds a `llm_traces_status_started_at_idx` index not explicitly listed in the spec, useful for listing runs by status.
- `packages/shared/types.d.ts` could not be regenerated cleanly with `kysely-codegen` because the local `NUXT_DATABASE_URL` points to a database that contains many non-aso-notes tables; restored the previous file and appended the three new interfaces by hand. This is noted as a tooling/environment concern.

### Unit tests

Skipped for Phase 1 — there is no runtime code yet, only schema. Coverage is provided by the migration-level feature spec above.

### Typecheck / lint

- Full e2e project passes: 312 tests in 40 files.
- `pnpm lint` clean.
- `pnpm --filter web nuxt typecheck` fails due to an existing npm/pnpm override conflict (`vue@^3.5.28 conflicts with direct dependency`), not related to Phase 1 changes.

## Concerns for Phase 2 (instrumentation seam)

- The registry `server/lib/ai/registry.ts` will need a `TracedProvider` decorator that accepts an explicit `trace` option and writes rows fire-and-forget. This is the seam where cost is captured from OpenRouter `usage.cost` and metadata-only embeddings are recorded.
- `llm_generations.prompt`/`response` and `llm_tool_calls.output` will be large; truncation of tool output (~8KB) must happen at write time, not DB layer.
- Decide whether to write traces synchronously (transaction risk) or asynchronously (loss risk) — the ticket specifies fire-and-forget writes with try/catch-log.

## Phase 2 — Instrumentation seam & registry integration (done)

### Built

- `apps/web/server/lib/observability/trace-writer.ts` — Kysely helpers:
  - `createTrace`, `appendGeneration`, `appendToolCall`, `finishTrace`
  - `safeTraceWrite` fire-and-forget wrapper that logs failures without throwing.
  - JSONB columns are `JSON.stringify`ed at write time to match the project convention (see `messages.tool_calls`).
- `apps/web/server/lib/observability/traced-provider.ts` — decorators:
  - `TracedLLMProvider` and `TracedEmbeddingProvider` wrapping the existing provider interfaces.
  - Explicit `trace` option per call: `{ traceId, workspaceId, useCase, seq }`.
  - Non-streaming completions record one `llm_generations` row with full prompt/response, token usage, latency, cost, and finish reason.
  - Streaming variant (`completeStream`) accumulates chunks and records one generation on completion/error.
  - Embeddings record metadata-only: `prompt` stays null, usage/cost/latency recorded when available.
  - Missing usage sets token/cost columns to null and `usage_missing` to true.
  - Provider errors are recorded in the `error` column and the original error is rethrown.
  - Tracing write failures never break the LLM call.
- Registry integration in `apps/web/server/lib/ai/registry.ts`:
  - `resolveLLMProvider` and `resolveEmbeddingProvider` accept optional `TraceResolveOptions` (`{ db }`).
  - With trace context they return a traced provider; without it they return the plain provider.
  - `ResolveOptions` gained `fetchFn`/`sleepFn` injection for testability.
- OpenRouter providers updated to surface `usage.cost` and `finish_reason`:
  - `apps/web/server/lib/ai/openrouter-llm.ts` passes `cost` and `finishReason` through `CompletionResult`.
  - `apps/web/server/lib/ai/openrouter-embedding.ts` implements `embedWithUsage` returning `EmbeddingResult` with cost/tokens.
- Schema refinement:
  - Migration `apps/web/migrations/20260810000000_llm_generations_usage_missing.ts` adds `llm_generations.usage_missing` boolean to implement the "null + flag" locked decision.
  - `packages/shared/types.d.ts` and `apps/web/db/schema.sql` regenerated/updated.

### Tests

- `apps/web/test/unit/traced-provider.spec.ts` (10 tests, unit project):
  - non-streaming records one generation with correct fields
  - streaming accumulates to one record
  - embedding records metadata-only (prompt null)
  - missing usage → nulls + flag
  - tracing write failure does NOT break the LLM call
  - error responses recorded with error field
- `apps/web/test/e2e/llm-tracing-instrumentation.spec.ts` (4 tests, e2e project):
  - registry returns plain provider without trace context
  - registry-produced traced provider writes real `llm_generations` rows linked to a real `llm_traces` row
  - missing usage flag recorded end-to-end
  - embedding traced end-to-end with metadata-only
- Existing `apps/web/test/e2e/llm-tracing-schema.spec.ts` updated for the new `usage_missing` column.

### Divergences from ticket resolutions

- Added `usage_missing` boolean column in Phase 2 rather than Phase 1; the Phase 1 schema omitted the explicit flag required by the locked "missing usage → null + flag" decision. Reason: the column is necessary to satisfy the decision literally, and the migration is additive and safe.
- `finish_reason` is surfaced in `CompletionResult` and recorded when the provider reports it; otherwise null. The locked decision listed `finish_reason` as a generation field but did not specify how it is sourced. Reason: OpenRouter reports it per choice; preserving it helps debugging.
- Streaming interface is added as an optional `completeStream` method on `LLMProvider` rather than being pre-existing. Reason: the current provider interface had no streaming; making it optional lets the decorator satisfy the streaming requirement without breaking existing call sites or provider implementations.
- Cost is recorded as a numeric string (`'0.000300'`) rather than a number, because `cost_usd numeric(12,6)` returns formatted strings from Kysely. The value is still the passthrough from `usage.cost`.
- Trace writes are awaited (through `safeTraceWrite`) but errors are swallowed; the requirement says "fire-and-forget". Reason: in the current test harness, unawaited async writes race against test transaction rollback. Awaiting keeps tests deterministic while still guaranteeing tracing failures never propagate to the LLM call. This can be revisited when a background queue is added.
- Tool-call truncation (~8KB) is not implemented in `appendToolCall`; it is stubbed for later phases. Reason: tool-call recording is not yet wired to real call sites, and the truncation rule concerns later usage.

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 316 tests in 41 files (one initial flaky run due to hook timeout, passed on retry).
- `pnpm --filter web vitest run --project unit` passes: 435 tests in 38 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Concerns for Phase 3 (pipeline tracing)

- The four call sites (extraction stage, agent loop, consolidation judge, embed stages) must create `llm_traces` rows, pass `traceId`/`workspaceId`/`useCase`/`seq` to provider calls, and call `finishTrace` on completion/failure.
- The extraction stage currently records `extractionRecord` on the note; Phase 3 should decide whether to keep that denormalised copy or replace it with a trace lookup.
- Streaming in the agent chat currently happens at the SSE level, not the LLM provider level. If true LLM streaming is introduced later, `completeStream` should be wired through the agent loop.
- `appendToolCall` is implemented but unused; Phase 3/4 will need to call it from the agent tool-execution wrapper and decide on the 8KB output truncation policy.

## Phase 3 — Pipeline tracing (ingestion + consolidation)

### Built

- Ingestion Run tracing (`apps/web/server/lib/sync/ingest.ts`):
  - One `llm_traces` row per run (`kind='ingestion'`, `owner_type='notes'`, `owner_id=note.id`), created before the pipeline runs and finished with `completed`/`failed`.
  - Trace creation/finish are wrapped in `safeTraceWrite` so tracing failures never break ingestion.
  - `PipelineContext` gained `traceId` and a `nextSeq()` counter; stages pass trace options to provider calls.
  - `ExtractGraphStage` records the extraction LLM call as a Generation with full prompt/response.
  - `EmbedChunksStage` records each embedding batch as a metadata-only Generation (`llm_use_case='embedding'`, `prompt` null).
  - `apps/web/server/lib/pipeline/singleton.ts` now resolves traced providers when a DB is available, so production ingestion emits generations.

- Consolidation Run tracing (`apps/web/server/lib/consolidation/engine.ts`, `judge.ts`, `shortlist.ts`, `prune.ts`):
  - One `llm_traces` row per run (`kind='consolidation'`, `owner_type='consolidation_runs'`, `owner_id=run.id`).
  - Each judge batch call receives an incrementing `seq` and is recorded as a Generation (`llm_use_case='consolidation'`).
  - `batchJudge` accepts an optional `BatchJudgeContext` and passes `TraceOptions` to every `ConsolidationJudge` invocation.
  - `createDefaultJudge` forwards trace options to the LLM provider.
  - `makeDefaultJudge` resolves traced providers (passes `{ db }` to `resolveLLMProvider`/`resolveEmbeddingProvider`).

- `extractionRecord` pointer swap (`apps/web/server/lib/pipeline/last-run.ts`, `apps/web/server/api/notes/[...slug].ts`):
  - `notes.last_run.extraction` now stores cheap metadata (`strategy`, `model`, `usage`, `counts`) plus `trace_id`.
  - Heavy `messages`/`response` are written only to `llm_generations`.
  - `LastRun` validator accepts both the new pointer shape and legacy inline payloads (no backfill).
  - Note detail API hydrates `messages`/`response` from the linked generation; falls back to inline payload when `trace_id` is absent.
  - Note list API continues to strip heavy fields through `toLastRunSummary`.

- Consolidation usage rollup (`apps/web/server/lib/consolidation/engine.ts`, `apps/web/server/api/consolidation/runs/index.get.ts`, `apps/web/server/api/consolidation/runs/[id].get.ts`):
  - Removed any write path to `consolidation_runs.usage`.
  - `computeConsolidationUsage(runId)` reads `llm_generations` joined to the run's trace and returns `{ promptTokens, completionTokens, totalTokens }`.
  - API response shape stays compatible with `settings/consolidation/run-detail.vue`.

### Tests

- `apps/web/test/e2e/llm-tracing-pipeline.spec.ts` (3 tests, e2e project):
  - one trace per ingestion run, status completed
  - extraction Generation has full prompt/response/tokens/cost
  - embedding Generations are metadata-only (`prompt` null)
  - `notes.last_run.extraction.trace_id` present, no `messages`/`response`
  - failed ingestion marks trace failed
  - failed store-graph still leaves trace + generations intact

- `apps/web/test/e2e/llm-tracing-consolidation.spec.ts` (2 tests, e2e project):
  - one trace per consolidation run (`owner_type='consolidation_runs'`)
  - one Generation per judge batch with incrementing `seq`
  - `GET /api/consolidation/runs/:id` returns usage in the same shape, summed from generations
  - failing judge marks trace failed

- `apps/web/test/e2e/llm-tracing-readers.spec.ts` (3 tests, e2e project):
  - detail endpoint hydrates messages/response via `trace_id`
  - list endpoint summary strips `trace_id` and never exposes messages/response
  - detail endpoint falls back to inline payload for legacy `last_run` without `trace_id`

- Updated existing specs for the `extractionRecord` shape change:
  - `apps/web/test/e2e/ingest-graph.spec.ts`
  - `apps/web/test/e2e/pipeline-runner.spec.ts`
  - `apps/web/test/unit/extract-graph-stage.spec.ts`
  - `apps/web/test/e2e/notes-api.spec.ts` (pointer hydration + legacy fallback)

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 325 tests in 44 files.
- `pnpm --filter web vitest run --project unit` passes: 435 tests in 38 files.
- `pnpm --filter web vitest run --project nuxt` passes: 126 tests in 28 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Divergences from ticket resolutions

- `consolidation_runs.usage` is not dropped from the schema; it is simply no longer written by the engine and is computed on read. Removing the column would require a migration and is unnecessary for the API contract.
- `LastRun['extraction']` keeps optional legacy `messages`/`response` fields in the type so `parseLastRun` can support old rows without a data migration. New rows never populate them.
- Ingestion `seq` starts at 0 for the first provider call in pipeline order. Because `embed-chunks` runs before `extract-graph`, embedding generations receive lower sequence numbers than the extraction generation. This satisfies the "starts at 0 and increments" rule literally while preserving pipeline ordering.
- Trace writes during ingestion use `safeTraceWrite` but are awaited through it (same Phase 2 divergence) to keep tests deterministic against transaction rollback.

## Phase 4 — Agent chat tracing

### Built

- `apps/web/server/lib/agent/run-agent.ts` now creates one `llm_traces` row per Answer (`kind='chat'`, `owner_type='conversations'`, `owner_id=conversation.id`). The trace is created after the user message is persisted and the conversation id is known.
- `apps/web/server/lib/agent/loop.ts` passes a monotonic `seq` (shared with tool calls) to every LLM `complete` call via the `TraceOptions` parameter.
- `apps/web/server/lib/ai/types.ts` adds `TraceOptions` to the `LLMProvider` interface so the loop can pass tracing context without knowing whether the provider is wrapped.
- `apps/web/server/lib/agent/run-agent.ts` wraps the agent's LLM provider in `TracedLLMProvider` per Answer and wraps every tool to record `llm_tool_calls` rows via `appendToolCall`.
- `apps/web/server/lib/observability/trace-writer.ts` now truncates tool output to ~8KB with `truncateJsonOutput`: oversized JSON is wrapped as `{ __truncated: true, __originalBytes: N, head: "..." }`. Small values and `null`/`undefined` pass through unchanged.
- The final assistant Answer message is linked to the trace: `messages.trace_id` is set on the last assistant message without `tool_calls` when `persistLoopMessages` runs.
- `apps/web/server/api/conversations/index.post.ts` listens for the Node.js request `close` event and aborts a dedicated `AbortController`, which is passed to `runAgent`. On abort the trace finishes with `status='aborted'` and any partial generations/tool calls are retained.
- Tracing failures never break chat: `createTrace` failures are caught by `safeTraceWrite` and the Answer continues without a trace.
- `apps/web/server/lib/agent/providers.ts` now returns `llmProviderInfo` (provider kind + model) so `runAgent` can build the `TracedLLMProvider` with the correct provider/model metadata.
- `setAgentTestProviders` accepts an optional `llmProviderInfo` override and defaults to `{ kind: 'openrouter', model: 'test-model' }`.

### Tests

- `apps/web/test/e2e/llm-tracing-chat.spec.ts` (3 tests, e2e project):
  - one trace per Answer, kind `chat`, owner `conversations`, status `completed`
  - one Generation per LLM call with monotonic `seq` and usage/cost recorded
  - one Tool Call row per tool invocation, with tool output truncated at ~8KB for a large `read_note` result
  - the assistant Answer message has `messages.trace_id` equal to the trace id
- `apps/web/test/e2e/llm-tracing-chat.spec.ts` abort case:
  - passing an aborted `AbortSignal` to `runAgent` leaves the trace as `aborted` while retaining any generations/tool calls already recorded
- `apps/web/test/e2e/llm-tracing-chat.spec.ts` resilience case:
  - mocking `createTrace` to throw still yields a successful chat response and leaves no `llm_traces` row
- `apps/web/test/unit/trace-writer.spec.ts` (6 tests, unit project):
  - `truncateJsonOutput` preserves small values
  - truncates oversized JSON to roughly the byte limit
  - counts UTF-8 bytes, not string length
  - passes through `null`/`undefined`
  - `createSeqCounter` allocates monotonic integers starting at 0 (or a custom offset)
- Existing agent/conversation specs updated and passing.

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 328 tests in 45 files.
- `pnpm --filter web vitest run --project unit` passes: 441 tests in 39 files.
- `pnpm --filter web vitest run --project nuxt` passes: 126 tests in 28 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Divergences from ticket resolutions

- The `TraceOptions` interface was moved from `traced-provider.ts` to `ai/types.ts` and re-exported from the observability module, so the `LLMProvider` interface can accept an optional trace context without a circular dependency. This is a structural change but preserves the same shape.
- `llmProviderInfo` (kind + model) is returned by `getAgentProviders` and passed through `AgentContext` because the trace is created per Answer inside `runAgent`, not at provider resolution time. This lets the same resolved providers serve multiple Answers without re-instantiation.
- Disconnect detection is best-effort via the Node.js request `close` event. The in-process test harness does not exercise the real HTTP close path, so the abort case is tested by calling `runAgent` directly with an aborted `AbortSignal`. Production uses the same `AbortSignal` path.
- Tool-call trace writes are fire-and-forget (matching the existing generation write pattern) rather than awaited in the loop. Test determinism relies on the writes completing before the test transaction rolls back, which they do in practice because the loop is synchronous and the inserts are fast. The same caveat applies to Phase 2/3 generation writes.
- The truncation `head` string is not guaranteed to be valid JSON on its own; it is embedded inside a valid JSON wrapper object. The wrapper makes the truncation obvious and preserves the original byte count for debugging.

### Concerns for Phase 5 (retention job)

- The retention job must NULL `llm_generations.prompt`/`response` and `llm_tool_calls.output` while leaving metadata (tokens, cost, model, latency, status) intact. It should also stamp `pruned_at`.
- Chat traces have large tool outputs (especially `read_note`) already truncated at write time, but generations still carry full prompts/answers. The retention job should treat `kind='chat'` the same as other kinds.
- Consider a cleanup job for orphaned `llm_traces` whose owner rows no longer exist; the polymorphic owner has no FK, so there is no cascade delete.

## Phase 5 — Retention policy job (done)

### Built

- `apps/web/server/lib/observability/retention.ts` — retention core:
  - `purgeTraceContentForOwner(db, ownerType, ownerId)` nulls `llm_generations.prompt`/`response` and `llm_tool_calls.output`, stamps `pruned_at`, and keeps metadata + rows forever.
  - `purgeOldTraceContentForWorkspace(db, workspaceId, retentionDays, now)` time-bounds content pruning per workspace.
  - `purgeOrphanTraceContent(db, now)` sweeps traces whose `owner_type`/`owner_id` no longer matches a note, conversation, or consolidation run.
  - `runObservabilityRetentionSweep(db, now)` runs the age prune for every workspace, then the orphan sweep.
- `apps/web/server/lib/observability/retention-worker-helpers.ts` — constants (`OBSERVABILITY_RETENTION_QUEUE_NAME`, `OBSERVABILITY_RETENTION_JOB_NAME`, `DAILY_RETENTION_CRON = '30 4 * * *'`) and `scheduleObservabilityRetentionRepeatableJobs`.
- `apps/web/server/lib/observability/retention-job.ts` — `ObservabilityRetentionJob` BullMQ job class.
- `apps/web/server/plugins/observability-retention-worker.ts` — Nitro plugin registering the worker/queue with the `NUXT_DISABLE_OBSERVABILITY_RETENTION` guard and the 04:30 daily cron (offset from consolidation's 03:00).
- `apps/web/server/lib/settings.ts` — `observability.content_retention_days` exposed in `KNOWN_SETTING_KEYS`, resolved with default 365, validated, and returned by `resolveWorkspaceSettings`.
- Owner delete call-site wiring:
  - `apps/web/server/lib/sync/files.ts` — `handleFileUnlink` and `startupScan` purge note traces before DB deletion.
  - `apps/web/server/lib/sync/gc.ts` — `removeSyncedFolderAndCollectGarbage` purges traces for every note it deletes.
  - `apps/web/server/lib/onboarding/smoke-test.ts` — stale smoke-test note deletion purges its trace.
  - `apps/web/server/lib/consolidation/engine.ts` — lock-conflict run cleanup and the failure path already finish the trace; the run deletion purges traces.
  - `apps/web/server/lib/consolidation/snapshot.ts` — `pruneOldSnapshots` purges traces before deleting old consolidation runs.

### Tests

- `apps/web/test/e2e/observability-retention.spec.ts` (12 tests, e2e project):
  - old generation/tool-call content is nulled while metadata/rows survive
  - new content is left untouched
  - per-workspace retention days and default fallback
  - exact cutoff boundary (older than cutoff prunes, at/newer does not)
  - empty tables report zero pruning
  - idempotency of the daily sweep
  - orphan sweep for `owner_type='notes'`, `'conversations'`, and `'consolidation_runs'`
  - orphan sweep does not prune when the owner still exists
  - synced-folder removal immediately purges trace content before the note row is deleted
- `apps/web/test/unit/observability-retention.spec.ts` (4 tests, unit project) — scheduler duplicate-guard, constants, and cron.
- Updated existing settings specs for the new key:
  - `apps/web/test/e2e/settings-api.spec.ts` — GET default and PATCH validation for `observability.content_retention_days`.
  - `apps/web/test/unit/settings.spec.ts` — `resolveContentRetentionDays`, `normalizeSettingValue`, and `resolveWorkspaceSettings` behavior.

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 342 tests in 46 files.
- `pnpm --filter web vitest run --project unit` passes: 450 tests in 40 files.
- `pnpm --filter web vitest run --project nuxt` passes: 126 tests in 28 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Divergences from ticket resolutions

- The previous code comment said "a null workspace value means 'never prune'", but the locked ticket resolution only specifies a default of 365 days and does not require a null/never option. The `workspace_settings.value` column is `jsonb NOT NULL` and the settings API treats `value: null` as a row deletion (used by `onboarding.completed_at` and LLM `base_url`), so a literal null value cannot be stored without a schema migration. We followed the `consolidation.run_budget` precedent instead: positive integer only, default 365, null rejected. The null/never option was left out.
- No `DELETE /api/conversations/[id]` endpoint exists, so `purgeTraceContentForOwner` could not be wired at a conversation delete call site. The daily orphan sweep catches traces whose conversation owner has been deleted by any future code path.
- The scheduler duplicate-guard checks repeatable jobs by `name: 'daily-retention'` while `queue.add` uses the job class name (`ObservabilityRetentionJob`) as the BullMQ name. This mirrors the existing consolidation scheduler convention and the unit fake; if production BullMQ returns the job name rather than the jobId suffix, the guard could be adjusted, but it is consistent with the established pattern.

## Phase 6 — Chat trace UI (done)

### Built

- `GET /api/traces/[id]` endpoint (`apps/web/server/api/traces/[id].get.ts`) — workspace-scoped, auth required. Returns the trace, its generations and tool calls sorted by `seq`, plus computed totals (`totalTokens`, `totalCost`, `durationMs`). Pruned content (`prompt`/`response`/`output` null) is returned as-is; the UI renders a placeholder.
- Chat trace view presentational component (`apps/web/app/components/chat/chat-trace-view.vue`) and timeline component (`apps/web/app/components/observability/trace-timeline.vue`):
  - Plain cards, no timeline rail or dots (per locked ticket decision).
  - All steps expanded by default, still individually collapsible.
  - Indigo accent for generations, amber for tool calls.
  - Each step shows icon + name, one-line summary (tokens/cost/latency/finish reason or duration/status), and expandable prompt/response or input/output sections.
  - Expired/pruned content renders an i18n "Content expired" placeholder while metadata stays visible.
- Full-page route `app/pages/chat/[id]/trace/[traceId].vue` — auth/onboarding middleware, back link to the chat, header with status/totals/duration, uses `chat-trace-view`.
- Subtle per-Answer "View trace" link in `chat-thread.vue` whenever `message.trace_id` is present; conversation detail API now exposes `trace_id`, and `useChat.loadMessages` carries it into messages.
- i18n for every user-facing string (`apps/web/locales/en.json`), explicit `vue-i18n` imports, Tailwind-only styling, unplugin-icons.

### Tests

- `apps/web/test/e2e/llm-tracing-trace-read.spec.ts` (3 tests, e2e project):
  - 401 when unauthenticated.
  - 404 when the trace belongs to another workspace.
  - response shape: trace + generations + tool calls sorted by `seq`, totals computed, pruned content returned as `null` with `pruned_at` set.
- Component tests (`project 'nuxt'`):
  - `apps/web/test/components/chat-trace-view.nuxt.spec.ts` (4 tests): header/totals/steps expanded, generation vs tool-call styling, pruned-content placeholder, missing trace state.
  - `apps/web/test/components/trace-timeline.nuxt.spec.ts` (4 tests): steps expanded, styling, expired placeholder, collapse/expand toggle.
  - `apps/web/test/components/chat-thread.nuxt.spec.ts` updated (1 new test): trace link appears only when both `traceId` and `conversationId` are present.

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 345 tests in 47 files.
- `pnpm --filter web vitest run --project nuxt` passes: 135 tests in 30 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Divergences from ticket / prototype

- The full-page view is implemented as a thin route wrapper around a presentational `chat-trace-view` component rather than putting all markup in the page file. This keeps the page focused on data fetching and makes the UI unit-testable without mocking `useFetch`/`useRoute`.
- The per-Answer link is intentionally minimal: "View trace" only, without cost/tokens. The full cost and token totals are available on the trace page, and the locked decision favored a subtle affordance.
- A direct component test for the route page was not added: `mountSuspended` of a page with dynamic route params and `useFetch` hits a nuxt-seo-utils route initialization issue in the test harness. The page behavior is covered by the view component tests and the e2e endpoint tests; the page wrapper is only a thin `useFetch` + back link.
- `messages.trace_id` is only available on assistant messages after the detail API refreshes; streamed answers do not yet receive the trace id via SSE. The link therefore appears on the next detail load.

### Concerns for Phase 7 (future observability work)

- No list endpoint exists for traces (`/api/traces` or per-owner). A workspace-level trace list would be needed before exposing ingestion or consolidation trace timelines in the UI.
- The generic `GET /api/traces/:id` endpoint can already serve ingestion/consolidation traces, but there is no navigation to them yet. A future phase should decide whether to reuse the chat trace view or build a dedicated trace inspector.
- A `DELETE /api/conversations/:id` endpoint is still missing; when added it should call `purgeTraceContentForOwner(db, 'conversations', id)` before deleting the row, otherwise the orphan sweep is the fallback.
- Streaming chat answers could carry the new `trace_id` in the SSE `answer` event so the "View trace" link appears immediately without waiting for a detail refresh.

## Phase 7 — Usage & cost UI (done)

### Built

- `GET /api/usage` endpoint (`apps/web/server/api/usage/index.get.ts`) — workspace-scoped, auth required. Returns:
  - Time-window cards: `today` (since UTC midnight), `last7d`, `last30d` with `generations`, `tokens`, `costUsd`, and `usageMissingGenerations`.
  - Breakdown table grouped by `llm_use_case` × `model` over the last 30 days, with per-row `generations`, `tokens`, `costUsd`, and `usageMissingGenerations`.
  - A `total` footer row.
  - All rollups are read-time SQL aggregates; no materialized tables or caches.
- Settings page (`apps/web/app/pages/settings/usage.vue`) wired into the settings layout sidebar (`apps/web/app/layouts/settings.vue`) with a new "Usage" nav item.
- Presentational component `apps/web/app/components/settings/usage/usage-summary.vue` renders horizontal summary cards (label + three metrics side-by-side) and the grouped table. i18n via explicit `import { useI18n } from 'vue-i18n'`; Tailwind-only styling; unplugin-icons not needed.
- Shared `UsageSummary` type in `apps/web/app/types/usage-summary.ts` used by both endpoint consumer and component.
- `usage_missing` handling: generations with `usage_missing = true` are counted in the generation totals and flagged per row (amber badge) and in the summary notice, but their `null` tokens/cost are excluded from token and cost sums.

### Tests

- `apps/web/test/e2e/usage-api.spec.ts` (4 tests, e2e project):
  - 401 when unauthenticated.
  - empty summary on a fresh workspace.
  - correct time-window rollups and grouped table, including `usage_missing` rows counted but excluded from cost/tokens.
  - cross-workspace isolation.
- Component tests (`project 'nuxt'`):
  - `apps/web/test/components/settings-usage-summary.nuxt.spec.ts` (4 tests): renders title, cards, table, and total footer; shows usage-missing notice; handles empty state; handles error state.
  - `apps/web/test/components/settings-layout.nuxt.spec.ts` updated: expects the new "Usage" nav item and asserts it is active on `/settings/usage`.

### Typecheck / lint

- `pnpm lint` clean.
- `pnpm --filter web vitest run --project e2e` passes: 349 tests in 48 files.
- `pnpm --filter web vitest run --project nuxt` passes: 139 tests in 31 files.
- `pnpm --filter web vitest run --project unit` passes: 450 tests in 40 files.
- `pnpm --filter web exec nuxt typecheck` still fails with the pre-existing `vue@^3.5.28 conflicts with direct dependency` npm override error, unrelated to this phase.

### Divergences from ticket / prototype

- The cards are horizontal (label and three metrics side-by-side) as explicitly required, not the rejected vertical card stack from the prototype.
- The table and the 30-day cards both cover the same rolling 30-day window; the ticket did not specify a table time range, so the window was aligned with the longest card range.
- `today` is computed from UTC midnight rather than local midnight for deterministic server-side aggregation; this is a sensible default but may differ from a user's local expectation.
- `usage_missing` generations are included in the generation count and surfaced with a badge/notice; their `null` tokens/cost are excluded from sums. The ticket only asked that they be "visible somehow".
- The endpoint uses SQL `GROUP BY` plus raw `sum(...)` casts for the grouped table, and separate range queries for the cards. This is still a read-time rollup with no materialization.
- No chart/dashboard or compact-list variants were kept; the locked decision was cards + table only.
- A direct component test for the page route was not added because the page is only a thin `useFetch` wrapper around the `usage-summary` component; the route behavior is covered by the layout component test and the e2e endpoint tests.

### Concerns for future observability work

- The usage page is only as fresh as the `llm_generations` rows; real-time ingestion/chat spend may lag slightly while traces are written.
- There is no cost budget/threshold alert yet; the consolidation budget card exists but a workspace-level LLM budget is a separate future decision.
- No export/download of the usage table is provided; the user could screenshot or copy the table, but a CSV export would be a natural next step.

## Phase 8 — Hardening (done)

Review-driven cleanup of tracing correctness, dedup, and race/type issues. All 13 items:

1. **loop.ts `TraceOptions` import** — `loop.ts` imports `TraceOptions` from `../ai/types` (was missing, previously resolving implicitly). Done.
2. **traced-provider `ProviderKind` import from registry** — moved from `../ai/types` to `../ai/registry` (source of truth), keeping the `formatCost` behavior. Done.
3. **`usage_missing` flag fix** — the flag was `usage === undefined` only; a paid provider that returns token counts but no `cost` was silently unflagged. Added `isUsageMissing(kind, usage)`: missing usage object ⇒ `true`; `ollama` (local, no cost) ⇒ `false`; otherwise `usage.cost === undefined`. Applied to complete/stream/embedding. Unit case added in `traced-provider.spec.ts`.
4. **Workspace predicate in `hydrateLastRunDetail`** — now filters `llm_generations` by `workspace_id` in addition to `trace_id`/`llm_use_case`, so a note's last-run detail cannot leak an extraction from another workspace that shares the same trace pointer. Call site in `[...slug].ts` passes `workspaceId`. E2E cross-workspace case added.
5. **Retention skips `status='running'` traces** — `pruneContentForTraceIds` now filters to non-running traces before pruning (orphan + owner-delete paths), and `purgeOldTraceContentForWorkspace` excludes generations/tool calls belonging to a running trace. Prevents pruning content mid-write. E2E running-trace case added. **Note:** this guard was NOT present in the partial work despite being listed; I implemented it.
6. **`purgeTraceContentForOwner` gains `workspaceId`** — new first param, scoping `findTracesByOwner` to the workspace. All call sites updated: `sync/files.ts`, `sync/gc.ts`, `consolidation/engine.ts`, `consolidation/snapshot.ts`, `onboarding/smoke-test.ts`. E2E cross-workspace scoping case added.
7. **Type-narrowing in `run-agent.ts` `wrapTool`** — trace is built into a narrowed `traceOptions` const inside the `if (traceId)` branch and `wrapTool(t, traceOptions)` is called only there; `runAgentLoop(..., trace, ...)` still receives the `AgentLoopTraceOptions | undefined`. No narrowing error remains in the traced files. Typecheck tooling is broken repo-wide (pre-existing `vue` override conflict + `@monorepo/shared` not exporting `Database`/`DB` mismatch); verified by careful reading + comparing error counts (74 at HEAD → 71 now, no new errors introduced).
8. **i18n key** — `usage-summary.vue` used `t('chat.streaming')` as its loading text. Replaced with new `settings.usage.loading` ("Loading usage…") added to `en.json`.
9. **Startup `.catch`** — `scheduleObservabilityRetentionRepeatableJobs(queue)` in `observability-retention-worker.ts` now has `.catch(err => console.error('observability retention schedule failed', err))` (still `void`-ed) to avoid an unhandled rejection.
10. **Formatter dedup** — `formatTokens`/`formatMs`/`formatCost` extracted into a single `apps/web/app/utils/format-observability.ts` and imported by `chat-trace-view.vue`, `trace-timeline.vue`, and `usage-summary.vue`. Precision rule: `null/empty → '—'`, `>= $1 → $X.XX`, `else → $X.XXXX` (four decimals). This preserves the four-decimal behavior all three call sites already used for sub-dollar LLM costs (usage summary mock/spec asserts `$0.0003`); the `>= $1 → $X.XX` guard comes from the usage summary's copy. Documented in the module.
11. **Type dedup** — `TraceGeneration`/`TraceToolCall` declared inline in `chat-trace-view.vue` and exported from `trace-timeline.vue`; the view now imports them from `trace-timeline.vue`, so there is one canonical copy. The `server/api/traces/[id].get.ts` row types were left as-is: the endpoint intentionally shapes a response DTO (snake_case rows → camelCase with ISO strings + computed `totalTokens`/`totalCost`/`durationMs`), so it does not directly use the generated `DB` types.
12. **Dead code** — removed the redundant `try/catch` around `safeTraceWrite('createTrace', …)`; the function already swallows errors. Also switched `let traceId` to `const`.
13. **Seq counter consistency** — `consolidation/engine.ts` replaced its hand-rolled `let seq = 0; nextSeq: () => seq++` with the exported `createSeqCounter()` from `trace-writer.ts` (identical behavior, starts at 0).

### Tests

- `pnpm --filter web vitest run --project unit` — 451 passed in 40 files.
- `pnpm --filter web vitest run --project e2e` — 352 passed in 48 files.
- `pnpm --filter web vitest run --project nuxt` — 139 passed in 31 files.
- `pnpm lint` clean (after `lint:fix`).
- `pnpm --filter web exec tsc --noEmit -p .nuxt/tsconfig.json` still fails repo-wide with pre-existing errors (`vue` npm override conflict; `@monorepo/shared` not exporting `Database`), unrelated to this phase; error count dropped 74 → 71.

### Divergences from ticket / instructions

- Item 5 (retention running-guard) was listed as already done in the partial work but was NOT present in `retention.ts`; I implemented it and added the guard to both the shared pruner and the age-based workspace pruner. The partial work only added the test.
- Item 10 cost precision: instructions suggested `>= $1 → $X.XX, else $X.XXX`. I unified on `else $X.XXXX` instead because all three existing call sites used four decimals and the usage-summary spec asserts `$0.0003` (a three-decimal rendering would show `$0.000` and break it). Four decimals is the rule that fits the actual usage sites.
- Typecheck could not be run to green (repo-wide pre-existing breakage); item 7 was verified by careful reading and by confirming no new type errors were introduced.

## Phase 9A — Record aborted generations on disconnect (done)

Ticket `ticket-agent-chat-tracing.md` resolution: "on client disconnect mid-stream the Generation records the partial text with an aborted flag (+ error if any)". Previously the trace-level `status='aborted'` was set in `run-agent.ts`, but `llm_generations` rows recorded an aborted in-flight LLM call as if it completed normally, because the `AbortSignal` never reached the provider call inside `loop.ts`.

### Changed

1. **`apps/web/server/lib/agent/loop.ts`** — the two `ctx.llm.complete(...)` call sites (main loop + forced final wrap-up) now pass the already-threaded `signal` through to the LLM call. The `signal` was already a `runAgentLoop` parameter; it just wasn't forwarded.
2. **`apps/web/server/lib/observability/traced-provider.ts`** — `TracedLLMProvider.complete` and `completeStream` accept a `signal?: AbortSignal` and forward it to the wrapped provider. When a call throws `AbortError` (or the signal is aborted), the generation is recorded with `finish_reason='aborted'` and the error message. The streaming path also marks `response.finishReason='aborted'` for the partial text.
3. **Provider signature** (`apps/web/server/lib/ai/types.ts`, `openrouter-llm.ts`, `ollama.ts`) — `LLMProvider.complete` / `completeStream` gained a `signal?: AbortSignal` param; both built-in HTTP providers forward it to `fetch`.
4. `buildTraceOptions` refactor (shared `TraceContext` type) was already present in the working tree from Phase 8/earlier; `engine.ts` needed `useCase: 'consolidation'` on its trace context so `buildTraceOptions` produces a non-null `llm_use_case` (its call path otherwise hit a NOT NULL violation).

### Test setup (red → green)

- Unit (`apps/web/test/unit/traced-provider.spec.ts`, +2): a non-streaming `complete` that throws `AbortError` records `finish_reason='aborted'`, `response=null`, `usage_missing=true`; a streaming `completeStream` interrupted mid-stream records the partial text with `finish_reason='aborted'`.
- E2E (`test/e2e/llm-tracing-chat.spec.ts`) keeps green: mid-tool-call abort still leaves trace `status='aborted'` with ≥1 generation and ≥1 tool call; normal completion still records the provider's finish reason; tracing failure never breaks the chat response.

### Tests

- `pnpm --filter web vitest run --project e2e` — 352 passed in 48 files.
- `pnpm --filter web vitest run --project unit` — 453 passed in 40 files.
- `pnpm --filter web vitest run --project nuxt` — 142 passed in 31 files.
- `pnpm lint` clean.
- Typecheck unchanged (repo-wide pre-existing failure, unrelated to this phase).

### Limitation

- The current agent path is **non-streaming** (calls `complete`, not `completeStream`), so on abort there is no partial accumulated text to record; `response` is `null`. The partial-text-with-aborted-flag behavior is only exercised by the `completeStream` path (and its unit test), which the live agent does not use today. This matches the ticket's "partial may be unavailable; that is acceptable".

### Divergences

- **Working tree was not clean at task start** — a large pre-existing uncommitted batch (Phases 7/8 UI, retention refactor, usage API) was in the tree; it already contained most of this fix plus a red streamed-abort unit test and a few regressions. I fixed the remaining red test (`response.finishReason='aborted'` for the streamed case), plus three pre-existing failures needed to get the tree green before commit: `consolidation/engine.ts` missing `useCase` on its trace context (NOT NULL violation), `vitest.config.ts` unit project missing `~~`/alias resolution (broke `observability-retention.spec.ts` after `retention-worker-helpers.ts` was deleted), `usage-api.spec.ts` referencing out-of-scope `today`/`yesterday` dates, and removed dead unused type aliases in `server/api/traces/[id].get.ts`. These are commit-all, not part of the Phase 9A behavior itself.
- `run-agent.ts` trace-level `status='aborted'` handling was **not** touched, per the ticket.
- No schema migration, no new columns.


