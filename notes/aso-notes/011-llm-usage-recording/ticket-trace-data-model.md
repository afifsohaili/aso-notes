---
label: wayfinder:grilling
blocked-by: []
---

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
