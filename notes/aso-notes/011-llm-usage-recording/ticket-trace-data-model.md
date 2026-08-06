---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Trace data model

## Resolution (2026-08-06)

**Three tables, all workspace-scoped, UUID PKs:**

**`llm_traces`** — id, workspace_id, kind varchar (`ingestion` | `chat` | `consolidation`), **polymorphic owner: `owner_type` varchar + `owner_id` uuid, no FK** (user decision over nullable FK columns — flexibility for future trace kinds; consequence: no cascade, retention/cleanup must handle orphaned traces explicitly), status varchar (`running` | `completed` | `failed`), started_at, finished_at, error text, created_at/updated_at.

**`llm_generations`** — id, workspace_id, trace_id FK cascade, seq integer (flat ordering, no nesting), llm_use_case varchar, provider, model, **prompt JSONB nullable (inline full messages — TOAST handles size)**, **response JSONB nullable**, prompt_tokens int, completion_tokens int, **cost_usd numeric(12,6)** (computed at request time), latency_ms int, finish_reason varchar, error text, **pruned_at timestamp nullable**, created_at.

**`llm_tool_calls`** — id, workspace_id, trace_id FK cascade, seq integer, name varchar, input JSONB, **output JSONB nullable, truncated at ~8KB** (read_note can return whole notes), duration_ms int, status varchar, **pruned_at timestamp nullable**, created_at.

**Nesting: flat + seq on both child tables** (no parent_id). Agent loop iterations read from chronological order; nesting can be added later if debugging demands.

**Retention hooks: nullable content columns + `pruned_at`** on both child tables. The retention job (separate ticket) NULLs prompt/response/output and stamps pruned_at; metadata (tokens, cost, model, latency) survives indefinitely for cost tracking.

Column names borrow OTel GenAI conventions where practical (gen_ai.* → snake_case columns), keeping OTel export cheap later.

# Ticket: Trace data model

## Question

What are the exact tables and columns for Traces, Generations, and Tool Calls?

Decisions to pin down:

1. **Traces table**: id, workspace_id, kind (`ingestion` | `chat` | `consolidation`), the link columns (note_id? conversation_id? consolidation_run_id? — nullable vs separate link table), started_at/finished_at, status, summary fields?
2. **Generations table**: trace_id FK, llm_use_case, provider, model, prompt (full messages JSONB vs truncated text?), response, token counts, cost_usd (numeric precision?), latency_ms, error, finish_reason. Do prompt+response live inline (Postgres TOAST handles big text) or in a separate content table (OTel's "external storage with reference" pattern)?
3. **Tool Calls table**: trace_id FK, tool name, input args, output (truncated?), duration, ordering column within the trace?
4. **Nesting**: can a Generation/Tool Call have a parent (agent loop iterations → sub-spans), or is a flat per-trace list enough for /chat debugging?
5. **Retention column strategy**: does the schema anticipate pruning (e.g. content columns nullable so a retention job can null them while keeping metadata)?

## Context

- Borrow Langfuse's Trace/Observation model and OTel GenAI attribute names (see research-llm-observability.md).
- Existing precedent: `extractionRecord` stores full messages+response+usage per note (latest only, on the note row — no history).
- Every table workspace-scoped per repo convention.
