---
label: wayfinder:prototype
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Usage & cost UI

## Resolution (2026-08-06)

**Answer: Cards + table (Variant A).** Summary cards (today / 7d / 30d) + breakdown table: use case × model × generations × tokens × cost, with a total footer row. Lives as a new **Settings → Usage** page in the settings sidebar.

**Implementation note (user): cards must be horizontal** (label and value side-by-side, not stacked as in the prototype). Do not copy the prototype's vertical card layout.

Rejected: chart dashboard (daily stacked bars — more than needed), compact list (too little detail). Model breakdown stays in the table.

Prototype captured on branch `proto/usage-cost-ui` (all three variants + mock data; question: "where does cost/usage visibility live and what does it show?"). Main keeps none of it — reimplement with i18n, real rollup queries (computed on read per the cost-model ticket), tests, horizontal cards.

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
