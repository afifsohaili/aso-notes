# 04 — Settings UI warns and re-ingests on embedding model change

**What to build:** Embedding model is a per-workspace setting, but embeddings from different models are never comparable — switching models without re-ingesting silently breaks retrieval. After this ticket, changing the embedding model in the workspace settings shows a warning dialog explaining that all notes in the workspace will be wiped and re-ingested (re-chunked, re-extracted, re-embedded — LLM extraction tokens are spent again). On confirm, the existing rebuild flow runs: notes go to `pending`, the sweeper re-ingests them with the new model. Cancelling the dialog leaves the old model untouched.

**Blocked by:**
- 01 — Fix rebuild to reset all workspaces when dropping the shared AGE graph
- 03 — Test-connection probe accepts any model that can reach 2048

**Status:** done

- [x] Changing the embedding model in settings opens a warning dialog before anything is saved
- [x] Dialog copy makes clear: full wipe + re-ingest of the workspace's notes, LLM tokens spent again
- [x] Confirm triggers the rebuild flow; notes transition to `pending` and re-ingest with the new model
- [x] Cancel leaves the current model and data untouched
- [x] E2E test with 2048-dim embedding stubs covers the happy path

## Implementation notes / divergences

- The warning dialog is added to `/settings/llm-providers` (the steady-state page). The first-run **wizard** (onboarding) also edits the embedding model but is left as-is: on first run there is no pre-existing data to wipe, so a rebuild warning would be meaningless there.
- `saveRole('embedding')` still runs the live `test-connection` probe before opening the dialog. The probe result (embedding must be usable) gates the save first, then the model-change guard decides whether to warn. So the order is: test → (model changed?) → warn → confirm → save → rebuild.
- Order on confirm: PATCH the embedding model fields first, then POST `/api/settings/rebuild`. Failures in either step keep the dialog open with an inline error so the user can retry; the model is never saved unless the rebuild path can begin.
- Probe response shape divergence from Phase 3 (commit 4537eff) is reconciled: `test-connection` now returns only `{ ok, error }` (no `dims`/`expected`), so the `TestStatus` `dims` branch, the `llm-test-dims` template, the `settings.llm.dimsMismatch` i18n key, and the `result.dims` handling were removed from `llm-role-card.vue`, `llm-providers.vue`, and `settings-wizard.vue`.
- New pure util `didEmbeddingModelChange(previous, next)` in `app/utils/embedding-model-change.ts` (whitespace-insensitive) drives the "did the model actually change?" guard; unit tested.
- Component tests extend `settings-llm-providers-page.nuxt.spec.ts`; API-level e2e in `test/e2e/settings-model-switch.spec.ts` exercises the exact confirm path (PATCH model → POST rebuild → notes → `pending`) with 2048-dim embedding stubs.

