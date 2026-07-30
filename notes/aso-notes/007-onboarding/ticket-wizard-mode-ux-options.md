---
type: wayfinder:prototype
claimed:
blocked-by: []
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
