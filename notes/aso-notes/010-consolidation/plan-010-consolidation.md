# Vocabulary Consolidation — Plan

Parent: [Wayfinder map](map.md).

## Phase 1: schema + settings plumbing

Built:

- Database schema for Consolidation run bookkeeping:
  - `consolidation_runs` — workspace-scoped run record (mode `incremental|full|manual`, status `running|completed|failed`, started/finished timestamps, counts, usage, before/after metrics, flags, error text, created_at/updated_at).
  - `consolidation_snapshots` — one JSONB payload per run (workspace-scoped, FK to run with cascade).
  - `consolidation_run_changes` — one row per executed change (action `merge-concept|merge-topic|prune|rewrite|dissolve|refile`, text, reason).
- Migrations:
  - `20260806000000_consolidation_tables.ts` creates the three tables and indexes.
  - `20260806000001_consolidation_runs_timestamps.ts` adds `created_at`/`updated_at` to `consolidation_runs` using `if not exists` SQL (dev DB had already applied the base migration before those columns were added).
- Regenerated `packages/shared/types.d.ts` and dumped `apps/web/db/schema.sql`.
- Settings plumbing (`apps/web/server/lib/settings.ts`):
  - New known keys: `consolidation.run_budget` (positive integer, default 200).
  - New LLM role keys: `llm.consolidation.provider|model|base_url`.
  - `resolveConsolidationProviderSettings` falls back to the extraction role config (workspace rows → env `NUXT_LLM_EXTRACTION_*`) when consolidation is unset.
  - `resolveWorkspaceSettings` returns the consolidation keys with source annotations.
- LLM registry (`apps/web/server/lib/ai/registry.ts`): added `consolidation` role env key mapping (`NUXT_LLM_CONSOLIDATION_*`).
- Provider availability endpoint (`apps/web/server/api/settings/providers/index.get.ts`): includes `consolidation` role; openrouter availability falls back to the extraction API key when no consolidation key is set.
- Tests:
  - `apps/web/test/unit/settings.spec.ts` — unit tests for run_budget default, consolidation provider fallback to extraction, key normalization.
  - `apps/web/test/e2e/settings-api.spec.ts` — PATCH/GET round-trips for `consolidation.run_budget` and `llm.consolidation.*`, unauthenticated rejection, validation errors.
  - `apps/web/test/e2e/settings-providers.spec.ts` — providers endpoint includes consolidation and falls back to extraction API key; unauthenticated rejection.
- Tooling: added a `vitest` script to `apps/web/package.json` so `pnpm --filter web vitest run --project <name> <file>` works for single-project, single-file runs.

Divergences from ticket resolutions (with reasons):

- Phase 1 only creates the schema and settings plumbing; no Consolidation execution engine, snapshot capture, restore, or cost-guardrail enforcement. This matches the phase boundary: Phase 1 is the vocabulary Consolidation foundation, leaving run execution for later phases.
- The `consolidation_runs` migration file was edited after its first application to the dev DB, so the `created_at`/`updated_at` columns were added via a separate follow-up migration (`20260806000001`) instead of the base migration alone. The follow-up uses `if not exists` SQL so it is a no-op on fresh installs. This is a dev-history artifact, not a schema divergence.
