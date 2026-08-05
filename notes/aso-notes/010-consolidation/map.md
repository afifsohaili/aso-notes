---
label: wayfinder:map
---

# Wayfinder Map: Vocabulary Consolidation

## Destination

A clear route to implementing **Consolidation** — the AI cron job that keeps the workspace-global vocabulary (Concepts, Topics) clean — plus the Settings-page reorganization its UI lands on. The map is done when no decision remains undecided and someone can go build it.

## Notes

Domain: agentic graph-RAG over personal notes. See `notes/aso-notes/CONTEXT.md` for canonical terms (Concept, Topic, Mention, Relation, Ingestion, Synced Folder).

Skills to consult when working tickets: `/grilling`, `/domain-modeling`, `/prototype` (for UI tickets).

### Decisions locked in pre-map grilling (2026-08-04)

- **No per-folder ontology.** One workspace-global vocabulary; grounding comes from consolidation, not scoping. Synced Folders are mostly disjoint but share Concepts (e.g. "paddle billing"), and per-folder vocab would worsen fragmentation.
- **Topics stay flat.** No Topic nesting. "Hierarchy work" = merging similar Topics and re-filing Concepts under the right (merged) Topics via existing `concept_topics`.
- **Cron scope:** merge duplicate Concepts + merge similar Topics, re-file Concepts, prune junk, rewrite surviving descriptions to be succinct/disambiguating.
- **Merge criteria:** embedding-similarity shortlist → LLM judges each candidate pair. No freeform LLM over whole vocab; no strict-threshold-only.
- **Safety:** fully automatic + snapshot versioning. Snapshot the workspace's graph tables before each run (retain last N). Restore = copy back + reset later-ingested Notes to `pending` for re-extraction. Multi-step rollback works; cost of going further back = LLM re-ingestion spend.
- **Cadence:** nightly incremental (new since last run + near neighbors) + weekly full sweep. BullMQ repeatable job, gated by a `NUXT_DISABLE_*` flag.
- **First run:** full sweep + manual "Consolidate now" button in `/settings`.
- **LLM config:** new `CONSOLIDATION_{PROVIDER|BASE_URL|MODEL|API_KEY}` use-case, per-workspace overridable in `/settings`, falls back to `EXTRACTION_*`.
- **Extraction untouched:** cleaned vocab flows into extraction prompts automatically via the existing vocabulary strategies (`full` / `top-k` / `blind-merge`).
- **New glossary terms needed when building:** Consolidation, Consolidation Run, Snapshot → add to `notes/aso-notes/CONTEXT.md`.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Settings page tabs](ticket-settings-page-tabs.md) — Sidebar nav; Verification folds into LLM providers; Consolidation gets its own page under an "Extraction" nav group. Prototype on branch `proto/settings-tabs`.
- [Snapshot & restore mechanics](ticket-snapshot-restore-mechanics.md) — `consolidation_runs` + `consolidation_snapshots` (single JSONB payload of the 5 graph tables, retain 10); restore = copy back + deterministic AGE re-mirror (new routine) + reset later Notes to pending.
- [Merge execution mechanics](ticket-merge-execution-mechanics.md) — LLM judge picks survivor + merged description (re-embed on change); Mentions/Relations re-point + dedupe; AGE re-mirrored wholesale at end of run; cron = self-rescheduling BullMQ job with idle-queue gate.
- [Prune criteria](ticket-prune-criteria.md) — Concept shortlist ≤1 Mention AND ≤1 Relation + 7-day grace, LLM judges; empty Topics deleted outright, singleton Topics LLM-reviewed (keep vs dissolve); no bridge check (shortlist = leaves only).

## Not yet specified

- **Cost guardrails:** caps on LLM calls per run, batch sizing for the shortlist → judge loop. Sharpens once merge/prune mechanics are decided.
- **Measuring success:** does Consolidation actually improve retrieval quality? Eval approach hangs on observability being decided first.

## Out of scope

- Per-folder ontologies/taxonomies — rejected in grilling (worsens cross-folder fragmentation).
- Topic nesting (parent Topics) — rejected; Topics stay flat.
- Curation/merge review UI — rejected; cron is fully automatic, safety via snapshots.
- Event-level audit log — rejected; per-run snapshots double as the audit trail.
