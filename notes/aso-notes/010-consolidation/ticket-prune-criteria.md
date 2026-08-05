---
label: wayfinder:grilling
blocked-by: [ticket-merge-execution-mechanics]
claimed-by: afif
status: closed
---

# Ticket: Prune criteria

## Resolution (2026-08-05)

**Concept shortlist: ≤1 Mention AND ≤1 Relation, older than a 7-day grace period** (fresh extractions aren't judged prematurely). The LLM judges each candidate — specific reusable idea vs extraction noise — given name, description, and one sample Mention's chunk text as evidence. Approved junk is deleted; FK cascade removes its Mentions and Relations.

**Bridge safety: no connectivity check needed** (fact). The shortlist only admits leaf nodes (≤1 Relation), and removing a leaf never disconnects a graph.

**Topics: two-tier rule.** Empty Topics (0 Concepts after merges/re-filing) are deleted deterministically, no LLM. Singleton Topics (1 Concept) go to the LLM judge: keep as a legit niche theme, or dissolve — the Concept becomes Topic-less until a future extraction or run re-files it.

Rejected: pure heuristics (keeps 1-Mention junk forever, kills legit niche Concepts), LLM-reviews-everything (expensive, redundant with merge pass), never-prune-Topics (clutter accumulates).

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
