---
label: wayfinder:task
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Pipeline tracing (ingestion + consolidation)

## Resolution (2026-08-06)

**extractionRecord → pointer model.** `notes.last_run` keeps the cheap operational metadata (status, error, pipeline, duration_ms, failed_stage, chunks, attempt, job_id) and **gains `trace_id`**. The heavy extraction payload (messages/response/usage) stops being duplicated — written only to `llm_generations`. Consumers (fact-checked): the retry badge and smoke test don't read the extraction payload (untouched); note-detail.vue's extraction section switches to reading via trace_id. Old last_run payloads stay readable as-is — no backfill, no data migration.

**One Trace per Ingestion Run** (`kind='ingestion'`, `owner_type='notes'`): the extraction call = one Generation; each embedding call = a metadata-only Generation (`llm_use_case='embedding'`, prompt null per the seam decision). Tokens/cost recorded on every Generation.

**One Trace per Consolidation Run** (`kind='consolidation'`, `owner_type='consolidation_runs'`): judge batches = Generations (`llm_use_case='consolidation'`). This closes the deferred Phase 8/9 usage-recording gap — `consolidation_runs.usage` is dropped as a write target; usage/cost shown in the UI becomes a **rollup computed on read** from the run's Generations (consistent with the cost-model ticket).

# Ticket: Pipeline tracing (ingestion + consolidation)

## Question

How do Ingestion Runs and Consolidation Runs emit Traces, and what happens to the existing extractionRecord?

Decisions to pin down:

1. **extractionRecord migration**: it currently stores latest-only extraction detail (messages/response/usage) on the note. Replaced by traces (extraction detail becomes a Trace linked to the note), kept as-is, or kept as a pointer into the traces table? Existing UI (`/notes` last-run view?) must keep working — check its consumers.
2. **Trace per Ingestion Run**: one Trace per note ingestion, covering chunk embeddings + extraction Generation? Embeddings as Generations (separate use case) or a lighter record?
3. **Trace per Consolidation Run**: judge batches as Generations linked to the consolidation_runs row — does consolidation_runs.usage then become a rollup of its Generations (answering the deferred Phase 8/9 usage-recording gap)?
4. **Backfill**: none (out of scope per map) — but does extractionRecord's existing data stay readable?

## Context

- extractionRecord: server/lib/pipeline/context.ts, last-run.ts; extract-graph.ts writes messages+response+usage+counts.
- Consolidation judge calls: server/lib/consolidation/judge.ts (usage currently discarded — the known gap this closes).
- Blocked by data model + instrumentation seam.
