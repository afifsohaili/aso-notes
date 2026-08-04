---
label: wayfinder:prototype
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Settings page tabs

## Resolution (2026-08-05)

**Answer: Sidebar nav (Variant B), with two refinements:**

1. **Verification is not its own nav item** — it lives inside the **LLM providers** section.
2. **Consolidation gets its own page under an "Extraction" group** — the sidebar nav must support groups: `Extraction → Strategy`, `Extraction → Consolidation`.

Resulting nav structure (steady state):
- Synced folders
- LLM providers (includes Verification)
- Extraction
  - Strategy
  - Consolidation *(future — run history, "Consolidate now", `CONSOLIDATION_*` config)*
- Danger zone

Wizard mode keeps its own step UI, untouched.

Prototype captured on branch `proto/settings-tabs` (all three variants + switcher; question: "what tab structure should Settings have?"). Main keeps none of the prototype code — the sidebar gets reimplemented properly with i18n and tests.

## Question

`apps/web/app/pages/settings.vue` is ~865 lines and convoluted: LLM provider config (per-use-case), Synced Folders, connection testing, rebuild, and soon a Consolidation section (button, `CONSOLIDATION_*` config, run history). What tab structure should the Settings page have — which tabs, what lives on each — before the Consolidation UI is designed onto it?

HITL prototype ticket: build a rough tabbed reorganization of the existing page (no behavior changes) to react to.

## Context

- Current page handles: provider config per use-case (AGENT/EXTRACTION/EMBEDDING), Synced Folders CRUD, test-connection, rebuild (danger zone), onboarding wizard mode.
- Onboarding wizard mode must keep working — does it stay a single flowing page while post-onboarding gets tabs, or does the wizard use the first tab?
- Existing component test: `test/components/settings-page.nuxt.spec.ts`.
