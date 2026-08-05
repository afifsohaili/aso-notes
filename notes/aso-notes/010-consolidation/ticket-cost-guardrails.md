---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Cost guardrails

## Resolution (2026-08-05)

**Shared candidate budget: 200/run, configurable** (workspace setting `consolidation.run_budget`, editable from the Consolidation page). One budget covers merge pairs + prune candidates; merges are judged first (highest similarity first), prune gets the remainder. Overflow defers to the next run — candidates aren't lost, just spread over weeks. Incremental runs stay naturally bounded (new × top-10) but honor the same budget.

**Judge batching: 20+ candidate pairs per LLM call.** One structured response returns verdict (+ survivor + merged description) per pair. 200 candidates ≈ ~10 judge calls per run. Accepted trade-off: long-context judgment quality slightly degrades vs one-pair-per-call.

**No token ceiling.** Calls are arithmetically bounded by budget ÷ batch size (+ description rewrites), so a hard ceiling adds nothing. LLM usage per run is still recorded on `consolidation_runs` for visibility.

## Question

What caps keep a Consolidation run's LLM spend bounded as the vocabulary grows?

Decisions to pin down:

1. **Full-sweep pair cap:** pairwise embedding candidates above 0.75 across the whole vocabulary can explode at scale — cap pairs judged per run (e.g. 500)? Defer overflow to the next run, and in what priority order (highest similarity first)?
2. **Prune judge cap:** shortlist could be large after a big import — cap per run?
3. **Batching:** how many candidates per LLM call (one pair per call vs judging a batch in one call)?
4. **Token budget:** a hard per-run token ceiling that halts the run gracefully (snapshot still committed, counts recorded)?

## Context

- Graduated from the map's fog after Merge execution mechanics + Prune criteria were resolved.
- Per-run LLM calls = merge-pair judgments + prune judgments (+ description rewrites).
- `consolidation_runs` already records LLM usage per run (Snapshot ticket), so spend is observable.
