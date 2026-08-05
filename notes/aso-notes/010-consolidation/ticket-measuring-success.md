---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Measuring success

## Resolution (2026-08-05)

**Structural metrics first.** Computed from the snapshots already kept (before/after per run is free): near-duplicate Concept rate (embedding pairs >0.9), orphan rate (0 Relations), Concepts per Note, Topic size spread. Each run records before/after metric values; the run detail page shows the trend. No answer-quality eval set — too heavy for a personal tool; revisit if structural metrics ever look good but Answers feel worse.

**Two automatic warning flags on a run:**

1. **Over-pruning: Concept count dropped >20% in a single run — flat, no exemptions.** Rationale (user): at ~2–3 Notes/day, a steady-state weekly sweep should barely move the count, so >20% is unambiguous signal. The expected false positives are the first ~2–3 full sweeps (backlog drain — *designed* behavior); user accepts seeing red there and won't develop badge fatigue given real flags will be rare afterward.
2. **Ineffectiveness: near-duplicate rate fails to drop across 3 consecutive full sweeps** — the cron is running but not finding merges worth making.

Either flag = warning on the run + nav badge. Flags advise; the judgment call stays with the user.

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
