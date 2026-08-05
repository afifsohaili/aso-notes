---
label: wayfinder:prototype
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Consolidation page UI prototype

## Resolution (2026-08-05)

**Answer: Master-detail (Variant C).** Compact run list on the left, detail pane on the right (status + change counts, change lines with reasons, settings, restore panel).

**Requirement for the real implementation: mobile responsive.** The prototype's fixed two-column flex must collapse on small screens (e.g. run list becomes a selector/stacked above the detail pane). Note for prod code, not the prototype.

Elements confirmed in place: "Consolidate now" above the run list; per-run flags surfaced in the list (⚠ count) and detail; restore as its own red panel inside the detail pane with the one-way warning; config (run budget, `CONSOLIDATION_*` fallback) inside the detail pane.

Prototype captured on branch `proto/consolidation-page` (all three variants + shared switcher + mock data; question: "what should the Consolidation page look like?"). Main keeps none of it — reimplement properly with i18n, real data, tests, and responsive layout.

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
