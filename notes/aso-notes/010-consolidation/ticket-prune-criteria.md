---
label: wayfinder:grilling
blocked-by: [ticket-merge-execution-mechanics]
---

# Ticket: Prune criteria

## Question

What makes a Concept (or Topic) "junk" that the cron should delete outright rather than merge?

Decisions to pin down:

1. **Evidence signals:** zero/few Mentions? no Relations? generic name patterns? LLM judge with what rubric?
2. **Deletion semantics:** pruning a Concept deletes its Mentions and Relations — when is that safe vs. when should a low-value Concept be kept because it's the only bridge between two clusters?
3. **Threshold tuning:** fixed heuristics vs LLM judgment per candidate; how candidates are shortlisted cheaply.
4. **Topics:** when does a Topic get pruned vs merged (e.g. Topic with one Concept vs overlapping Topic)?

## Context

- Blocked by merge mechanics: prune reuses merge's deletion/rewiring machinery, so its physical behavior is defined there first.
- Failure mode this addresses: "generic/noisy extraction" (LLM-invented junk Concepts).
