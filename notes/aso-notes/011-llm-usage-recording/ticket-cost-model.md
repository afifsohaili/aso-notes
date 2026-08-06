---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Cost model

## Question

How is per-Generation cost computed and what does the pricing table look like?

Decisions to pin down:

1. **Pricing source**: per-model rates as workspace settings (`llm.pricing.{model}`)? A code-side table keyed by model prefix? Provider-reported cost (OpenRouter returns usage cost on some plans — check)?
2. **Unknown model**: a Generation with an unrecognized model — null cost vs best-effort prefix match?
3. **Currency/precision**: USD, numeric precision for micro-dollar amounts?
4. **Rollups**: are cost aggregations computed on read (SQL sum over generations) or pre-aggregated (daily rollups table)? Personal scale suggests on-read — confirm.
5. **Surfacing splits**: cost by LLM Use Case, by model, by day — which dimensions does the UI need (feeds the usage/cost UI ticket)?

## Context

- Decided: cost computed at request time (tokens × rate at that moment), never backfilled.
- Default provider is OpenRouter; Ollama (local) has zero cost — record as 0 or null?
- Blocked by data model: where cost_usd lives is decided there.
