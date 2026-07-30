---
type: wayfinder:prototype
claimed: kimi-2-7-phase-4 (2026-07-30)
blocked-by: []
status: closed
---

# Wizard-mode UX options

## Question

What does wizard-mode settings look and feel like? Produce a few (2–3) throwaway UI options to react to, using the `emotional-design-ux` skill — the first-run experience should feel guiding and confidence-building, not like a config chore.

Surface to cover in each option:

- Settings page in wizard mode: section order (synced folders → LLM roles → embedding → verify), progress/checklist treatment, validation states per section, the mandatory smoke-test verify step's progress display (test note moving through pending → queued → processing → ingested).
- The no-Redis hard-block state.
- Transition out of wizard mode into steady-state settings (what changes visually once `onboarding.completed_at` is set).
- First-run `/chat` empty state with the guided first query (rides along — same emotional beat: "it works, ask something").

Constraints: Tailwind only, heroicons via unplugin-icons, Vue 3 `<script setup lang="ts">`, i18n keys. Throwaway fidelity — rough is fine; link the prototype files from this ticket on resolution.

Existing page to extend, not replace: `apps/web/app/pages/settings.vue` (extraction strategy + danger zone stay as steady-state sections).

Resolution feeds: Author plan-007.

## Resolution

Closed as **implemented** (not a throwaway prototype). The chosen design is a single-page wizard on `/settings` that folds back into the existing steady-state settings page once `onboarding.completed_at` is set.

- Wizard mode surfaces a three-step progress bar (folder → LLM roles → verify). The active step is selectable; the LLM step is locked until a synced folder exists.
- The synced-folder step is a compact manager (add/remove absolute paths, validation errors, note counts).
- The LLM step shows three role cards (agent, extraction, embedding) with provider/model/base-url inputs, per-role provider availability based on env keys, a test-connection button, and a 2048-dim guard for embedding saves.
- The verify step is a placeholder for the smoke-test flow (covered by the next ticket).
- No Redis is a hard block: a warning banner appears at the top of the wizard and the user cannot proceed past configuration until the queue is available.
- Transition to steady state: the wizard title/subtitle and progress steps disappear; the folder manager and LLM cards become plain sections alongside the existing extraction strategy and danger zone.
- First-run `/chat` empty state is replaced with a guiding card: title, subtitle, and one-tap suggestion chips. Suggestions adapt to whether notes have been ingested.

Key files:
- `apps/web/app/pages/settings.vue` — wizard/steady-state layout and orchestration.
- `apps/web/app/components/settings/llm-role-card.vue` — per-role model card.
- `apps/web/app/components/settings/synced-folder-manager.vue` — folder add/remove UI.
- `apps/web/app/components/settings/wizard-step-verify.vue` — locked verify placeholder.
- `apps/web/app/pages/chat/index.vue` — first-run empty state.
- `apps/web/app/middleware/onboarding.ts` + `app/composables/onboarding.ts` — gate and status refresh.
- `apps/web/server/lib/settings.ts` — `onboarding.completed_at` setting registration.
- `apps/web/server/api/settings/providers/index.get.ts` — per-role provider availability.
- i18n keys added to `apps/web/locales/en.json` and `my.json`.

Specs:
- `test/e2e-built/onboarding-gate.spec.ts` (6 tests) — middleware redirect behaviour.
- `test/e2e/settings-api.spec.ts` + `test/e2e/settings-providers.spec.ts` — setting persistence and provider availability.
- `test/unit/settings.spec.ts` — setting validation.
- `test/components/settings-page.nuxt.spec.ts` (8 tests) — wizard/steady-state rendering and rebuild flow.
- `test/components/llm-role-card.nuxt.spec.ts` (5 tests) — role card behaviour.
- `test/components/chat-index-page.nuxt.spec.ts` (2 tests) — first-run empty state suggestions.

Test result: full suite **80 test files / 630 tests passed** (`pnpm test`).
