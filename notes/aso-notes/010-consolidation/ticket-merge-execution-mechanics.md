---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Merge execution mechanics

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
