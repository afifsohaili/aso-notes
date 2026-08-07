---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Cost model

## Resolution (2026-08-06)

**Cost source: `usage.cost` passthrough.** Verified fact: OpenRouter returns a full `usage` object — prompt/completion token counts (model-native tokenizer) AND `cost` in credits — automatically in every response, including the last SSE chunk when streaming (the `usage: {include: true}` param is deprecated; no params needed). TracedProvider reads `usage.cost` straight off the response and writes it to `llm_generations.cost_usd` at request time.

**Per provider:**
- OpenRouter (default): exact `usage.cost`, always present.
- Ollama: local, cost = 0.
- Custom base_url providers: may omit cost → `cost_usd = null` + flag, never estimated (consistent with the locked usage rule).

**No pricing table, no fetching, no cache, no drift problem.** Currency: USD (OpenRouter credits are USD-denominated). Embeddings: read usage if the provider returns it, else null.

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
