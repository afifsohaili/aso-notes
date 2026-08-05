---
label: wayfinder:prototype
blocked-by: []
---

# Ticket: Consolidation page UI prototype

## Question

What should the Consolidation page (Settings → Extraction → Consolidation) look like?

Elements to arrange, per resolved tickets:

- "Consolidate now" button (enqueues `full` mode run)
- Run history list: mode, when, status, change counts, LLM usage per run
- Run detail: the execution-time change lines (e.g. "Merged 'RAG' into 'Retrieval-Augmented Generation'. Reason: same concept.")
- Per-run "Restore to before this run" button + confirm dialog spelling out: graph reverts, Notes ingested since re-extract (LLM spend), one-way door
- `CONSOLIDATION_*` provider config (may live here or under LLM providers — part of the question)

HITL prototype ticket: rough variants on the real settings route, `?variant=` switcher, same approach as the settings-tabs prototype.

## Context

- Spawned from the observability ticket's resolution (2026-08-05): user chose per-run restore without pre-restore snapshot and asked for a UI prototype.
- Nav structure decided in Settings page tabs: Consolidation is its own page under the Extraction group.
