---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Cost guardrails

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
