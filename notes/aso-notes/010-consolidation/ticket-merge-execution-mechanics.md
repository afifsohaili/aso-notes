---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Merge execution mechanics

## Resolution (2026-08-05)

**Concept merge (relational):** Mentions re-point to the survivor — `UPDATE ... WHERE NOT EXISTS` against the `(chunk_id, concept_id)` unique index, then delete the stragglers. Relations re-point from/to the survivor; duplicates on `(from, to, type)` dedupe to the earliest row, preferring a non-empty description.

**Survivor + description: the LLM judge decides.** The same call that approves a pair also names the survivor and writes the merged description (applies to Concepts and Topics alike). If the merged description differs from the survivor's existing one, the survivor's embedding is recomputed. Loser row is deleted; its embedding dies with it.

**Topic merge:** `concept_topics` re-point + dedupe on `(concept_id, topic_id)`. No note-level Topic assignments exist (fact-checked: note-level extraction topics only mint Topic rows), so nothing else moves.

**Re-filing Concepts** under Topics = `concept_topics` delete+insert. No live AGE work.

**AGE: full re-mirror at end of run.** The cron mutates relational tables only; when the run finishes it calls the deterministic re-mirror routine (decided in Snapshot & restore mechanics). No surgical Cypher per merge.

**Race policy: self-rescheduling BullMQ job.** The cron dispatches a Consolidation job; the job's first step is an idle-queue gate — if any Ingestion is active/waiting, it throws and self-reschedules with backoff. FK cascade is the backstop for the tiny residual window. Merges commit per-merge (partial progress survives failure; the pre-run snapshot protects the rest).

## Question

When the cron merges two Concepts (or two Topics), what physically happens?

Decisions to pin down:

1. **Concept merge:** Mentions re-point to the surviving Concept. Relations re-point — and when that creates duplicate Relations (same type + same endpoints), dedupe how (keep oldest? merge properties?). What happens to the loser's embedding, description? Survivor selection rule (most Mentions? oldest? LLM picks?).
2. **Topic merge:** `concept_topics` rows re-point and dedupe. Note-level topic assignments?
3. **AGE rewiring:** every relational merge needs the mirror updated — delete loser node, move edges. New mirror functions vs wipe-and-rebuild of affected subgraph.
4. **Re-filing Concepts:** when a Concept moves Topic, is that just `concept_topics` delete+insert + `GROUPED_UNDER` edge swap?
5. **Transactionality:** one tx per merge vs per run; what does the pipeline do if the cron runs while an Ingestion is mid-flight on the same Concepts (row locks? skip locked?).

## Context

- `apps/web/server/lib/pipeline/stages/store-graph.ts` — how Concepts/Topics/Relations/Mentions are written today, incl. `mergeOnStore` similarity-merge precedent.
- Pre-map decision: embedding shortlist + LLM judge decides *which* pairs merge; this ticket decides *how* a merge executes.
