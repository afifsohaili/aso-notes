---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Snapshot & restore mechanics

## Question

What is the exact snapshot format and restore flow for Consolidation runs?

Decisions to pin down:

1. **Snapshot storage:** new tables (`consolidation_runs`, `consolidation_snapshots` with JSONB payload) vs shadow copies of the graph tables. What metadata does a run record (started/finished, mode incremental|full, counts of merges/prunes/rewrites, LLM usage)?
2. **Payload contents:** which tables — `concepts`, `topics`, `concept_topics`, `relations`, `mentions` (all workspace-scoped)? Include `note_tags` AI rows?
3. **Restore flow:** truncate + copy back, then reset Notes ingested after the snapshot to `pending` (reuses re-ingestion machinery). Confirm nothing else references Concept/Topic IDs.
4. **The AGE gap:** today's `rebuildWorkspaceGraph` re-mirrors AGE only by full re-ingestion. Does restore need a lighter "re-mirror AGE from relational" routine, or is reset-to-pending + re-ingestion the v1 answer?
5. **Retention:** how many snapshots kept; is the count user-configurable?

## Context

- `apps/web/server/lib/rebuild.ts` — existing wipe + reset-to-pending semantics to mirror.
- AGE is a mirror of relational state (`mergeTopicNode`, `mergeGroupedUnderEdge` in store-graph).
- Pre-map decision: snapshots double as the audit trail; no event-level log.
