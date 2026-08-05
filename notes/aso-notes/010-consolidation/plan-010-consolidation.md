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

## Phase 2: AGE re-mirror routine

Built:

- Deterministic `remirrorGraph` routine in `apps/web/server/lib/graph/remirror.ts`, exported from `apps/web/server/lib/graph/index.ts`.
- Re-mirror semantics (per workspace):
  - Clear workspace-scoped AGE state by `DETACH DELETE`-ing `Concept` and `Topic` vertices for the workspace; this removes incident `RELATES_TO`, `GROUPED_UNDER` and `MENTIONS` edges without touching `Note`/`Tag` vertices or `TAGGED`/`LINKS` edges, which are outside the consolidation snapshot scope.
  - Replay relational rows into AGE using the existing `mergeConceptNode`, `mergeTopicNode`, `mergeNoteNode`, `mergeMentionsEdge`, `mergeRelatesToEdge` and `mergeGroupedUnderEdge` helpers, so labels/properties match store-graph exactly.
  - Mentions are collapsed from per-chunk relational rows to one `MENTIONS` edge per Note → Concept pair, matching store-graph behaviour.
- Returns a `RemirrorCounts` object (concepts, topics, noteVertices, mentions, relations, conceptTopics) for observability.
- Integration tests in `apps/web/test/e2e/graph-remirror.spec.ts` covering:
  - full replay of concepts/topics/relations/mentions/concept_topics into AGE;
  - idempotency (run twice yields identical AGE state);
  - empty workspace;
  - orphan concepts with no topics;
  - workspace boundary (other workspace untouched);
  - multi-chunk mention collapse into a single edge.

Divergences from ticket resolutions (with reasons):

- The routine clears workspace-scoped vertices rather than dropping/recreating the whole AGE graph. The existing graph is single-tenant (`notes_graph`) with `workspace_id` properties, so dropping the whole graph would wipe every workspace. The clear-then-replay approach preserves other workspaces and is still idempotent.
- Note vertices are created as needed for `MENTIONS` edges but are not deleted by the routine. This mirrors store-graph semantics (Note vertices only appear when they have graph incident edges) and avoids destroying `TAGGED`/`LINKS` edges for the workspace, which are outside the five-table consolidation snapshot.
- The existing `rebuildWorkspaceGraph` (`apps/web/server/lib/rebuild.ts`) was left unchanged because it performs a broader reset (truncates relational graph tables, resets Notes to pending, drops/recreates AGE); `remirrorGraph` is a narrower AGE-only repair tool.

## Phase 3: snapshot capture & restore service

Built:

- Snapshot service module `apps/web/server/lib/consolidation/snapshot.ts` exporting:
  - `captureSnapshot(db, runId, workspaceId)` — reads the five graph tables (`concepts`, `topics`, `concept_topics`, `relations`, `mentions`) workspace-scoped, writes one `consolidation_snapshots` JSONB payload with `{ concepts, topics, concept_topics, relations, mentions, captured_at }`, then prunes history.
  - `restoreSnapshot(db, snapshotId, workspaceId)` — authorizes the snapshot belongs to the workspace, truncates the five tables workspace-scoped, bulk-inserts from the payload in FK-safe order, calls `remirrorGraph`, then resets post-snapshot ingested Notes to `pending`.
  - `listSnapshots(db, workspaceId)` and `getSnapshot(db, snapshotId, workspaceId)` helpers scoped by workspace.
- Hard-coded retention of 10 snapshots per workspace. Because `consolidation_snapshots` and `consolidation_run_changes` both FK to `consolidation_runs` with `ON DELETE CASCADE`, retention is enforced by deleting the oldest runs beyond 10; this keeps run history, snapshots, and change lines consistent.
- Restore notes-reset uses `notes.created_at > snapshot.captured_at` plus `status = 'ingested'`; `notes` has no `ingested_at` column, and `created_at` is the only ingestion-relevant timestamp that marks when the Note entered the workspace.
- Integration tests in `apps/web/test/e2e/consolidation-snapshot.spec.ts` covering:
  - snapshot payload contents and DB row;
  - restore reverts graph mutations and re-mirrors AGE;
  - Notes created after the snapshot are reset to `pending`, older ingested Notes stay `ingested`;
  - retention prunes oldest runs/snapshots beyond 10 and never touches another workspace;
  - workspace isolation on restore (wrong workspace → error);
  - empty workspace capture/restore;
  - zero post-snapshot ingested notes.

Divergences from ticket resolutions (with reasons):

- Retention deletes the oldest **run rows** (cascading to their snapshots and change rows), not only snapshot rows. The Phase 1 schema cascades both `consolidation_snapshots` and `consolidation_run_changes` on run delete, and the ticket resolution said "Retention: last 10 runs, hard-coded." Keeping runs+snapshots+changes together avoids orphaned run rows and gives a consistent 10-run audit window; the UI can already display runs without snapshots.
- Notes reset filters by `status = 'ingested'` AND `created_at > captured_at`. The ticket says "reset Notes ingested after the snapshot to pending"; since there is no `ingested_at` column, `created_at` is used as the timestamp, and filtering to `ingested` avoids resetting Notes that are already pending/queued/processing/failed.
- Snapshot payload stores `captured_at` inside the JSONB alongside the five table dumps. The `consolidation_snapshots` row also has its own `created_at`; `captured_at` is intentionally duplicated in the payload so restore logic can read it from the self-contained payload without joining the snapshot row.

## Phase 4: consolidation engine

Built:

- Core engine `runConsolidation(db, workspaceId, mode, options?)` in `apps/web/server/lib/consolidation/engine.ts`:
  - Creates a `consolidation_runs` row, captures a snapshot first, then executes merges/prunes/topic cleanup, re-mirrors AGE, and finalizes the run with metrics/flags/counts.
  - Injected `judge` and `embeddingProvider` for deterministic tests; production defaults resolve providers from workspace settings + `NUXT_LLM_CONSOLIDATION_*` / `NUXT_LLM_EXTRACTION_*` / `NUXT_LLM_EMBEDDING_*` env.
  - Per-merge commits; a failed run marks the row failed and re-throws, leaving partial merges applied (protected by the pre-run snapshot).
- Merge shortlist (`apps/web/server/lib/consolidation/shortlist.ts`):
  - Concept and Topic pairs from top-10 embedding neighbors above cosine 0.75; full mode scans all rows, incremental mode only rows created after the last successful run's `finished_at`.
  - Prune candidates: Concepts with ≤1 Mention, ≤1 Relation, and older than the 7-day grace period.
- Merge execution (`apps/web/server/lib/consolidation/merge.ts`):
  - Concept merge: survivor keeps its ID; loser mentions re-point via `INSERT ... ON CONFLICT DO NOTHING`; loser relations re-point + dedupe on `(from, to, type)` preferring earliest non-empty description; `concept_topics` re-point; loser deleted; survivor re-embedded when its description changes.
  - Topic merge: `concept_topics` re-point and union; loser topic deleted; survivor re-embedded when description changes.
- Prune execution (`apps/web/server/lib/consolidation/prune.ts`):
  - Concept prune deletes the row (FK cascade cleans mentions/relations/concept_topics).
  - Empty Topics deleted deterministically after merges/prunes.
  - Singleton Topics reviewed by the judge; approved ones are dissolved (topic deleted, concept becomes topic-less).
- Cost guardrails (`apps/web/server/lib/consolidation/engine.ts`):
  - Shared candidate budget from `consolidation.run_budget` (default 200); merges judged first, prunes get the remainder, overflow defers to the next run.
  - LLM judge batches candidates in groups of 20 per call; `counts.judgeCalls` is recorded on the run.
- Metrics and flags (`apps/web/server/lib/consolidation/metrics.ts`):
  - Before/after metrics: concepts, topics, near-dupe rate (pairs >0.9 cosine), orphan rate, concepts/note, topic spread.
  - `overPruning` flag when concept count drops >20% in a run.
  - `ineffectiveness` flag when near-dupe rate fails to drop across 3 consecutive full sweeps.
- Default LLM judge (`apps/web/server/lib/consolidation/judge.ts`):
  - Structured `json_schema` response; returns verdicts for merge pairs (merge boolean, survivor, merged description, reason) and prune candidates (prune boolean, reason).
- Tests:
  - Integration spec `apps/web/test/e2e/consolidation-engine.spec.ts` covering run lifecycle, snapshot capture, concept/topic merges, re-pointing, prunes, topic cleanup, budget enforcement, incremental mode, >20% flag, AGE re-mirror, and restore-to-snapshot.
  - Unit spec `apps/web/test/unit/consolidation-engine.spec.ts` for pure shortlist helpers.
- No regressions: full test suite (796 tests) passes; `pnpm lint` clean.

Divergences from ticket resolutions (with reasons):

- **Re-filing Concepts is not implemented as a separate step.** The map lists "re-file Concepts" as cron scope, but the closed tickets only define the mechanism (`concept_topics` delete+insert) and do not specify a decision procedure for when/why a Concept should move Topics. To avoid inventing behavior, re-filing is folded into merge/prune side-effects only (e.g., merging Concepts or Topics naturally re-points `concept_topics`). A future phase needs a dedicated decision rule before adding a separate re-file action.
- **Singleton Topic review is not budgeted from the shared candidate budget.** The shared budget covers merge-pair candidates + concept prune candidates. Singleton topic dissolution is reviewed after the budgeted phase because the tickets do not explicitly include it in the "merge first, prune gets remainder" pool. The cost is naturally bounded by the number of singleton Topics (usually tiny), and the action still writes a `dissolve` change line.
- **Topic merge is sorted by embedding similarity alongside concept merges.** The ticket says merges are judged "highest similarity first"; no separate prioritization by kind was specified, so concept and topic pairs share one sorted list.
- **No token ceiling.** The cost guardrail ticket rejected a hard token ceiling in favor of an arithmetic bound from budget ÷ batch size; the engine records `counts.judgeCalls` for observability but does not cap tokens.
- **Survivor re-embedding happens per merge when the description changes.** The ticket says "re-embed survivor if name/description changed"; the engine only detects description changes (name changes are not produced by the judge schema) and re-embeds using the same `name: description` input format as ingestion.
- **Metrics `nearDupeRate` is computed as near-dupe pairs / total pairs, not as a per-concept rate.** The ticket says "near-dupe rate (pairs >0.9 cosine)"; the implementation uses the literal pair rate. The ineffectiveness flag uses this rate across consecutive full runs.

## Phase 5: BullMQ worker, cron scheduling, and API endpoints

Built:

- Consolidation job abstraction (`apps/web/server/lib/consolidation/job.ts`): `ApplicationJob` subclass `ConsolidationJob` with queue name `consolidation`, supporting per-workspace and all-workspaces payloads.
- Worker helpers (`apps/web/server/lib/consolidation/worker-helpers.ts`): idle ingestion-queue gate, repeatable-job scheduler for nightly incremental (`0 3 * * *`) and weekly full (`0 3 * * 0`) sweeps.
- BullMQ adapter (`apps/web/server/utils/job-adapter.ts`): production `JobAdapter` so `ApplicationJob.performLater` reaches BullMQ; registered by the worker plugin.
- Worker plugin (`apps/web/server/plugins/consolidation-worker.ts`): gated by `NUXT_DISABLE_CONSOLIDATION=1` and Redis presence, schedules repeatable jobs, consumes the consolidation queue, throws on busy ingestion so BullMQ retries.
- Conflict check helper (`apps/web/server/lib/consolidation/queue-helpers.ts`): per-workspace active/waiting job detection used by the manual-run endpoint.
- API endpoints:
  - `POST /api/consolidation/run` — enqueues a manual `full` run for the caller's workspace; 401 unauthenticated, 400 no workspace, 503 no Redis, 409 if an active/waiting consolidation job already exists for that workspace; returns `{ enqueued: true, mode: 'manual' }`.
  - `GET /api/consolidation/runs` — workspace-scoped run history, latest first, with full run fields (mode, status, timestamps, counts, usage, metrics, flags, error).
  - `GET /api/consolidation/runs/:id` — run detail including change lines and a `hasSnapshot` flag.
  - `POST /api/consolidation/runs/:id/restore` — restores the run's snapshot via `restoreSnapshot` (which re-mirrors AGE and resets later notes to pending); 404 if no snapshot or run belongs to another workspace; returns restore counts and `restored: true`.
- Tests:
  - `apps/web/test/e2e/consolidation-api.spec.ts` — 11 integration tests covering 401/403/404 authz, manual enqueue with queue fixture, run history, run detail, snapshot restore, and workspace isolation.
  - `apps/web/test/unit/consolidation-worker.spec.ts` — 10 unit tests for idle-gate decision logic, 409 conflict check, and repeatable-job scheduling (no duplication, fill missing).
- No regressions: full suite 817 tests pass; `pnpm lint` clean.

Divergences from ticket resolutions (with reasons):

- The 409 conflict check is scoped to the caller's workspace only, not to all active/waiting consolidation jobs. The ticket says "409 if a consolidation job already active/waiting for that workspace," so the implementation checks only jobs whose data includes the same `workspaceId`. Global scheduled jobs have no `workspaceId` and therefore do not block manual runs.
- The `NUXT_DISABLE_CONSOLIDATION=1` guard is implemented in the worker plugin and skips both scheduling and worker initialization, mirroring the `NUXT_DISABLE_NOTES_SYNC` pattern. It does not disable the manual `POST /api/consolidation/run` endpoint; manual triggering remains available even when automatic scheduling is disabled, matching the semantics of the existing sync disable flag.
- Scheduled cron jobs are single global jobs that iterate over all workspaces rather than per-workspace repeatable jobs. This avoids the need to manage adding/removing repeatable jobs as workspaces are created or deleted, and the per-workspace engine already handles the mode and high-water mark correctly.
- Restore is one-way with no pre-restore snapshot, as specified in the observability ticket. The endpoint delegates to the existing `restoreSnapshot` service, which re-mirrors AGE and resets post-snapshot ingested notes to pending.

## Phase 6: settings UI reorg (sidebar nav + child pages)

Built:

- Reorganised the single `apps/web/app/pages/settings.vue` (~865 lines) into a multi-page settings section:
  - Root `pages/settings.vue` — detects onboarding/wizard mode and redirects to `/settings/folders` in steady state; hosts the unchanged wizard UI.
  - `components/settings/settings-wizard.vue` — extracted wizard component (folder step, LLM step, verification step) moved out of the page.
  - `pages/settings/folders.vue` — Synced Folders section.
  - `pages/settings/llm-providers.vue` — LLM providers section with Verification folded in (re-verify smoke test).
  - `pages/settings/extraction.vue` — extraction strategy form + danger-zone rebuild.
  - `pages/settings/extraction/consolidation.vue` — empty Phase 7 placeholder page.
  - `layouts/settings.vue` — shared settings layout with desktop sidebar nav and a mobile horizontal-scroll nav.
- Routing: `/settings` redirects to `/settings/folders`; each section has its own route; Consolidation is nested under `/settings/extraction/consolidation`.
- Mobile responsive: desktop sidebar collapses to a top horizontal-scroll pill nav on small screens (Tailwind only).
- i18n: all new components use explicit `import { useI18n } from 'vue-i18n'`; added new locale keys for nav labels and the consolidation placeholder.
- Wizard/onboarding mode preserved functionally — it is still a first-run gate on `/settings` and still uses the same API calls and step logic.
- No server-side changes.
- Tests:
  - Updated `apps/web/test/components/settings-page.nuxt.spec.ts` for the new root page (wizard + redirect).
  - Added `apps/web/test/components/settings-folders-page.nuxt.spec.ts`.
  - Added `apps/web/test/components/settings-extraction-page.nuxt.spec.ts`.
  - Added `apps/web/test/components/settings-llm-providers-page.nuxt.spec.ts`.
  - Added `apps/web/test/components/settings-consolidation-page.nuxt.spec.ts`.
  - Added `apps/web/test/components/settings-layout.nuxt.spec.ts` covering nav sections, active highlighting, and mobile nav presence.
  - Existing `test/e2e/settings-api.spec.ts` and `test/e2e/settings-providers.spec.ts` still pass (no server/API changes).
- No regressions: full component project (110 tests) and e2e settings specs pass; `pnpm lint` clean.

Divergences from ticket resolutions (with reasons):

- The child pages each fetch their own data rather than the original single page making all requests at once. This is a natural consequence of splitting into deep-linkable routes; the same endpoints, payloads, and behaviour are preserved. A shared composable could be added later to deduplicate fetches when users hop between settings tabs, but the current layout persists across client-side navigation so `useFetch` already caches per-key.
- The sidebar nav renders "Consolidation" as a flat item visually indented under "Extraction"; the prototype did not prescribe a specific nested-group component, and a flat indented list keeps the mobile horizontal-scroll nav simple while still communicating the parent/child URL relationship.
- The prototype included a dev-only variant switcher and three layout shells; only the sidebar approach was kept, and the switcher/shells were not merged into `main`.
- Verification was folded into the LLM providers page as a re-verify section rather than as a separate wizard-only or standalone page, matching the prototype decision that "Verification folds INTO the LLM providers section".

(End of file - total 124 lines)
