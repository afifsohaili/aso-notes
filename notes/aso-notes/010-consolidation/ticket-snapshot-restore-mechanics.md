---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Snapshot & restore mechanics

## Resolution (2026-08-05)

**Storage:** two new tables. `consolidation_runs` records one row per run: id, started_at/finished_at, mode (`incremental` | `full` | `manual`), status, change counts (merges/prunes/rewrites), LLM usage. `consolidation_snapshots` holds one row per run with a **single JSONB payload** — the full dump `{concepts, topics, concept_topics, relations, mentions}`. **Retention: last 10 runs, hard-coded.**

**Payload contents (fact-derived):** exactly the 5 graph tables. Only `relations`, `mentions`, `concept_topics` reference Concept/Topic IDs (all cascade), so the payload is self-contained. `tags`/`note_tags` are excluded — Consolidation doesn't mutate them (locked scope).

**Restore flow:** truncate the 5 tables (workspace-scoped) → bulk-insert from the JSONB payload → **re-mirror AGE** → reset Notes ingested after the snapshot to `pending` so they re-extract against the restored vocabulary. Multi-step rollback works the same way for any retained snapshot; cost of going further back = LLM re-ingestion spend for more Notes.

**AGE re-sync: new deterministic re-mirror routine.** Drop + recreate the AGE graph, replay every relational row (Concepts, Topics, `concept_topics`, Relations) into it. Zero LLM spend; doubles as a general graph-repair tool. Extracted from the mirror logic in store-graph (`mergeTopicNode`, `mergeGroupedUnderEdge`, relation edges). Rejected: full re-ingestion (pays LLM cost for every Note) and surgical AGE revert (complex, needs perfect inverses).

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
