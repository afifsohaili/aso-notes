---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Measuring success

## Question

How do we know Consolidation actually improves the graph — that Answers and retrieval get better, not just tidier?

Decisions to pin down:

1. **Metrics:** what proxies are observable — duplicate-name rate, orphan Concept rate, Concepts per Note, Topic sizes? Or behavioral — do agent traversals (`find_paths_between`, `get_concept_neighbors`) hit more useful nodes?
2. **Before/after comparison:** snapshot data makes a quantitative before/after cheap (run metrics on snapshot N vs N+1) — which metrics justify a restore-or-keep judgment?
3. **Eval set:** do we keep a fixed set of test Queries and compare Answers across a consolidation run, or is that overkill for a personal tool?
4. **Failure signal:** what measurement would make you *turn the cron off or tune it* — e.g. legitimate Concepts pruned, over-aggressive merges?

## Context

- Graduated from the map's fog after observability was resolved (2026-08-05): change lines + snapshots now exist, so before/after measurement has data to work with.
- Original failure modes this whole effort targets: fragmented Concepts and generic/noisy extraction.
