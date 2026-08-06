---
label: wayfinder:task
blocked-by: [ticket-trace-data-model, ticket-instrumentation-seam]
---

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
