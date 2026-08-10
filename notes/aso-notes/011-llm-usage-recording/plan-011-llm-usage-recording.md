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
