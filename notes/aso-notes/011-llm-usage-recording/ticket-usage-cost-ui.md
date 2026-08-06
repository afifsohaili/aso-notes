---
label: wayfinder:prototype
blocked-by: [ticket-cost-model]
---

# Ticket: Usage & cost UI

## Question

Where does cost/usage visibility live and what does it show?

Elements to arrange:

- Location: new Settings page (e.g. Settings → Usage)? A dashboard route? Embedded per-feature (consolidation run detail already shows tokens)?
- Dimensions: cost by day, by LLM Use Case, by model (from the cost-model ticket); token volumes; Generation counts
- Time ranges: today / 7d / 30d / all?
- Density: cards + table vs charts (no chart lib currently — sparkline-by-hand vs table-first)?

HITL prototype ticket: rough variants with mock data, `?variant=` switcher.

## Context

- Cost tracking is the map's headline use case ("mainly for cost tracking").
- Blocked by cost model: the dimensions decided there shape this UI.
