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
