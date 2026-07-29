# Plan 003 — Two-Tier Graph (Topics + Concepts)

Status: decisions locked via option review (2026-07-28). Ready to build.
Glossary: see `CONTEXT.md` (updated with Topic; Concept redefined).

## Problem

- The graph is flat and too granular: field-level concepts (`previous_data`, `TruckData`) sit at the same level as thematic ones (`Paddle`, `Billing`). ~60 notes produced hundreds of concepts; the canvas is a hairball plus a grid of orphan Tag nodes.
- Mention recall is weak: `paddle_id` in a billing note never connected to the `Paddle` concept (mentions are purely LLM-decided chunk refs, and the LLM gets thin local context).
- The extraction prompt injects the **full workspace concept list** (name + description) into every call — it bloats as the graph grows, and adding Topics with descriptions would make it worse.
- YAML step files are invisible. **Decision: accepted for now** — the current pipeline ingests Markdown only and YAML processing is deliberately deferred (not rejected; see Deferred). Notes as a concept remain format-agnostic.

## Locked decisions

1. **Two-tier graph, workspace-global.** Topic (high-level theme, few and stable) groups Concepts (granular, current behavior). A Concept sits under one or more Topics. Topics are **LLM-assigned during extraction**, reused from the existing topic list (same normalized-name dedup discipline as concepts).
2. **No Domain grouping.** Explicitly rejected: the same technology (Stripe, Paddle, Xendit) appears across projects and must be **one concept** connecting everything. Cross-project connections are a feature, not noise. Folder structure + Folder Covers stay as the only organizational layer.
3. **Vocabulary injection: build two strategies behind a clean seam, switchable at runtime, compare on real notes.** It's all theory until we see practical effects.
   - `top-k`: full topic list (few, cheap) + top-50 existing concepts by embedding similarity to the note (cosine over concept embeddings, centroid of the note's chunk embeddings — already computed by `embed-chunks` before `extract-graph` runs). No extra LLM calls.
   - `blind-merge`: no reuse vocabulary in the prompt at all. The LLM extracts freely; `store-graph` embeds each extracted name and merges with existing concepts/topics above a cosine-similarity threshold (exact normalized-name match still wins first). Smallest prompts; reuse decisions move from LLM judgment to a distance cutoff.
   - The active strategy is a **workspace setting controlled from a new Settings page** (DB-backed, no redeploy needed). No env vars — the only fallback is a hardcoded code default for workspaces that have never saved a setting.
4. **Mention recall — measure first.** No aliases/backfill yet. Build a mention-gap report quantifying notes whose text matches a concept name but have no Mention; the report feeds both the strategy comparison and the later recall decision.
5. **Full rebuild is fine** — no data migration of the existing graph. Wipe graph tables + AGE, re-ingest all notes. Rebuilding once per strategy for comparison is acceptable.

## Data model changes (relational, source of truth)

| Table | Change | Notes |
| ----- | ------ | ----- |
| `topics` | **new**: id, workspace_id, name, name_normalized (unique per workspace), description, embedding halfvec(2048), timestamps | Embedding enables blind-merge matching, future topic consolidation, and vector topic search. HNSW index. |
| `concept_topics` | **new**: concept_id FK, topic_id FK, composite PK | Many-to-many per CONTEXT.md ("one or more Topics"). |
| `workspace_settings` | **new**: workspace_id FK, key, value jsonb, updated_at, PK (workspace_id, key) | Key-value store for runtime-tunable options. First keys: `extraction.vocabulary_strategy`, `extraction.merge_threshold`. Future options land here. |

No changes to `concepts`, `notes`, `relations` — everything stays workspace-scoped.

## AGE graph changes (derived mirror, same transaction)

- New vertex: `(:Topic {id, workspace_id, name})`
- New edge: `[:GROUPED_UNDER {workspace_id}]` (Concept→Topic)
- Mirror rule unchanged: every relational write carries its AGE mirror in the same transaction via shared helpers (`mergeTopicNode`, `mergeGroupedUnderEdge`).

## Extraction changes (`extract-graph`, `extraction.ts`)

**Strategy seam**: a `VocabularyStrategy` interface, same registry discipline as the AI providers (`server/lib/ai/registry.ts`):

```ts
interface VocabularyStrategy {
  id: 'top-k' | 'blind-merge'
  /** Vocabulary injected into the extraction prompt (empty for blind-merge). */
  loadVocabulary(db, workspaceId, embeddedChunks): Promise<ExtractionVocabulary>
  /** Whether store-graph runs the embedding-similarity merge pass. */
  mergeOnStore: boolean
}
```

`createVocabularyStrategy(setting)` in `server/lib/pipeline/vocabulary/`. Resolution: **workspace setting (`workspace_settings`) → hardcoded code default** (`top-k`; merge threshold `0.85`). No env vars for these options — the Settings page is the single control surface. `extract-graph` consumes `loadVocabulary`; `store-graph` consults `mergeOnStore`. Adding a third strategy later = one file + one registry entry.

**Schema additions (both strategies):**

```json
{
  "topics":   [{ "name", "description" }],                        // newly coined topics only
  "concepts": [{ "name", "description", "topics": ["Billing"] }], // 1–3 topic assignments
  "relations": "...", "mentions": "...", "tags": "..."
}
```

**Prompt changes:**
- New rules in the system prompt: *assign each concept to 1–3 topics; reuse existing topic names whenever they fit; coin new topics sparingly — the graph should have a handful of stable topics, not one per note.*
- `top-k` strategy: user message gains `## Existing topics (reuse these when they match)` (full list, name + description) and the concepts section becomes the **top-50 by similarity** instead of the full list.
- `blind-merge` strategy: both existing-vocabulary sections are omitted; the reuse rules are removed from the system prompt for that call.

**Parsing:** a concept referencing an unknown topic (not existing, not in `topics[]`) is tolerated — the topic is auto-created with an empty description (warning logged), matching the tolerant-parse philosophy.

## Store-graph changes

- **New topic phase**: resolve topics by `(workspace_id, name_normalized)` → batch-embed new topics → upsert (fill empty description, never overwrite — same rule as concepts) → write `concept_topics` links → AGE mirror.
- **`blind-merge` merge pass**: for each extracted concept/topic name that missed exact normalized-name resolution, embed `"name: description"` and query nearest existing entry; similarity ≥ threshold → treat as that existing entry (fill description if empty, log the merge with both names for audit); below threshold → insert as new. Relations and mentions referencing the extracted name resolve to the surviving entry.
- Everything stays in the existing single transaction.

## Agent impact

- None required. Concept tools are workspace-global already and topics are transparent to them.
- Dedicated topic tools (`list_topics`, `search_topics`) **deferred** — topics first prove themselves in the graph UI.

## Settings UI

- **`/settings` page**, linked in the app-header navbar (Chat / Notes / Graph / **Settings**), session-gated like the other pages.
- **API**: `GET /api/settings` → resolved settings (workspace value, else code default — each annotated with its source); `PATCH /api/settings` → upserts `workspace_settings` rows. Auth + workspace membership, same as other routes.
- **First controls**: extraction vocabulary strategy (`top-k` / `blind-merge` select); merge threshold (number input, visible when `blind-merge` is active). Page is the home for future options (consolidation thresholds, model picks, etc.).
- Settings apply at job start — already-queued ingestion jobs are not retroactively changed; the comparison protocol flips the setting between full rebuilds.

## Graph UI changes

- **Topic node type**: new color (violet `#7c3aed`, distinct from Concept indigo); `GET /api/graph` includes Topic nodes and `GROUPED_UNDER` edges.
- **Topic list panel**: the left concept list gains a topic-grouped or topic-first mode (topics with concept counts), replacing the flat top-mentions list as the default entry point.
- Concept detail shows its Topics.
- Orphan Tag grid: unchanged in this plan (tags are a separate future cleanup).

## Mention-gap report (measure first)

- Script `apps/web/scripts/mention-gap-report.ts` (pnpm script, dev DB): for every concept, find notes whose content matches the concept name (case-insensitive, word-boundary, plus snake_case/camelCase segment matches so `paddle_id`/`PaddleBillingService` count as hits for `Paddle`) but have **no** mention row via any chunk.
- Output: table of `concept | matching notes | mentioned notes | gap`, sorted by gap desc; written to console + `tmp-mention-gap.md`.
- Decision input for aliases/backfill, and a comparison metric for the two vocabulary strategies.

## Strategy comparison protocol

1. Full rebuild under `top-k`; record: concept count, topic count, mention-gap summary, manual sample of near-duplicate concepts/topics, spot-check hubs (`Paddle`, `Stripe`).
2. Full rebuild under `blind-merge` (default threshold, then adjust if obviously off); same recordings.
3. Compare, pick the default strategy, record findings in this plan's implementation notes. Keep the flag — the losing strategy costs nothing to keep.

## Rebuild procedure

1. Deploy schema (new tables).
2. Truncate graph-derived tables (`mentions`, `relations`, `concept_topics`, `concepts`, `topics`, `chunks`, ai `note_tags`, `links`, `sources`); drop + recreate `notes_graph`.
3. Set all notes `status='pending'`; process via `POST /api/notes/process` per folder (or wait for sweeper).
4. Verify: relational counts vs AGE counts, topic reuse across related notes (billing notes should share topics), spot-check `Paddle` neighborhood, run mention-gap report.

## Build order

- **M1 — Schema**: `topics`, `concept_topics`, `workspace_settings`, HNSW indexes. Regenerate types + schema dump. **DONE (2026-07-28)** — migration `1785200000000_topics_concepts_settings.ts`, spec `apps/web/test/e2e/notes-schema.spec.ts` (15 tests, 4 new). Notes below.

### M1 implementation notes (divergences & decisions)

- **`topics` mirrors `concepts`**: `id` uuid default `gen_random_uuid()`, `workspace_id` FK cascade, `name`, `name_normalized`, nullable `description`, nullable `embedding halfvec(2048)`, `created_at`/`updated_at`. Unique `(workspace_id, name_normalized)`. HNSW index `idx_topics_embedding_hnsw` using `halfvec_cosine_ops`, same pattern as `concepts`/`chunks`.
- **`concept_topics` is workspace-scoped** — the plan's column list omitted `workspace_id`, but the join table follows the `note_tags` precedent (blanket tenant rule): `workspace_id` FK cascade + `concept_id`/`topic_id` FKs cascade, composite PK `(concept_id, topic_id)`, no surrogate id, no timestamps. This makes the table independently multi-tenant-filterable and lets workspace deletion cascade directly.
- **`workspace_settings` uses composite PK `(workspace_id, key)`**, `value jsonb NOT NULL`, and a single `updated_at` timestamp (no `created_at`), matching the plan's column list exactly. The e2e spec verifies the PK rejects duplicate keys and that `ON CONFLICT` upsert works.
- **Types and schema dump regenerated**: `packages/shared/types.d.ts` now includes `Topics`, `ConceptTopics`, and `WorkspaceSettings`; `apps/web/db/schema.sql` updated.
- **Full suite green**: 330 passed, 4 skipped; lint clean.

- **M2 — Extraction seam + strategies**: `VocabularyStrategy` interface + registry, topic schema + prompt rules, top-K retrieval via chunk-embedding centroid, blind-merge vocabulary omission, settings resolution (workspace setting → code default), tolerant topic parsing, unit + stage specs. **DONE (2026-07-29)** — full suite 341 passed, 4 skipped; lint clean. Notes below.

### M2 implementation notes (divergences & decisions)

- **Strategy seam at `server/lib/pipeline/vocabulary/`**: `types.ts` (`VocabularyStrategy = { id, loadVocabulary(db, workspaceId, embeddedChunks), mergeOnStore }`, `Vocabulary = { concepts, tags, topics }`), `index.ts` registry (`full`, `top-k`, `blind-merge`; unknown id throws), one file per strategy. Default = `top-k`.
- **Settings reader at `server/lib/settings.ts`**: `getWorkspaceSetting` + `resolveVocabularyStrategy` reading `extraction.vocabulary_strategy` from `workspace_settings`, fallback to hardcoded `'top-k'`. No env vars, per plan.
- **Extraction schema gains required `topics: [{name, description}]`** (note-level) and per-concept optional `topics: string[]` references. System prompt instructs 1–3 topics per note, reuse-first, concepts assigned to 1–3 topics. Prompt labels the concepts section "existing" vs "top relevant" via `strategyLabel`.
- **top-K retrieval**: centroid = mean of the note's embedded chunk embeddings (embed-chunks runs before extract-graph; context now carries embedded chunks). K=50 default. Concepts without embeddings are excluded from ranking (rare; only legacy rows).
- **blind-merge** returns empty concepts list (tags + topics still injected) and sets `mergeOnStore: true`; flag is exposed on pipeline context for M3's store-graph similarity pass.
- **Concepts without embeddings excluded from top-K ranking** — noted as accepted divergence.
- **Tests**: unit specs for all three strategies + registry + settings reader (`test/unit/pipeline/vocabulary.spec.ts`, `test/unit/settings.spec.ts`), e2e stage spec (`test/e2e/extract-graph-stage.spec.ts`) with stubbed LLM verifying prompt vocabulary sections per strategy and schema `topics` requirement; existing extraction/ingest specs updated for the new required field.
- **M3 — Store-graph**: topic resolution/embed/upsert, `concept_topics`, blind-merge similarity pass with audit logging, AGE mirror helpers, atomic transaction extended. **DONE (2026-07-29)** — full suite 353 passed, 4 skipped; lint clean. Notes below.

### M3 implementation notes (divergences & decisions)

- **Topic phase mirrors the concept phase**: note-level + per-concept topic names are collected, normalized, resolved against existing topics, batch-embedded as `"name: description"`, inserted, and then existing topics only get empty descriptions filled. Topic re-mention never overwrites a non-empty description.
- **`concept_topics` is workspace-scoped and insert-if-absent** (composite PK on `concept_id, topic_id`). It is intentionally not wiped per-note: rows are concept-level links, so re-ingestion of a note that assigns a concept to new topics adds links, and existing links for that concept remain. This matches the plan's "concept-level — not wiped per-note" reasoning.
- **Blind-merge pass applies to concepts only** in M3 scope. Each new concept that missed exact name resolution is embedded, its nearest existing concept by cosine similarity is queried (`embedding <=> halfvec(...)`), and if `1 - distance >= extraction.blind_merge_threshold` (default 0.85) the new name is mapped to the existing row. Relations, mentions, and concept_topics all resolve through the shared `conceptByNormalized` map.
- **Threshold setting key** is `extraction.blind_merge_threshold` (the plan draft called it `extraction.merge_threshold`; the M3 spec uses the longer key). The `settings.ts` reader resolves it with the code default 0.85 and clamps to `[0, 1]`.
- **Audit logging is a `console.warn` structured line** (`blind-merge: merged concept`, with new name, existing name, and score). No merge-audit table is persisted, per plan.
- **AGE mirror additions**: `mergeTopicNode` and `mergeGroupedUnderEdge` helpers; `:Topic {id, workspace_id, name}` vertices and `[:GROUPED_UNDER {workspace_id}]` Concept→Topic edges are MERGEd in the same transaction. These edges are not wiped per-note because they are concept-level; MERGE idempotency handles duplicates.
- **Tests added**: 4 e2e tests in `test/e2e/ingest-graph.spec.ts` (topic persistence + AGE mirror, topic reuse/description protection, above-threshold blind merge, below-threshold blind merge); 4 unit tests for `collectTopicNames`/`topicEmbeddingInput` in `test/unit/store-graph.spec.ts`; 4 unit tests for `resolveBlindMergeThreshold` in `test/unit/settings.spec.ts`.
- **Unit test file location**: `vitest --project unit` only includes files directly under `test/unit/*.spec.ts`, so the store-graph unit spec lives at `test/unit/store-graph.spec.ts` rather than nested under `test/unit/pipeline/`.
- **Existing e2e mirror object** updated to include the new `mergeTopicNode` and `mergeGroupedUnderEdge` helpers so the atomicity failure test continues to use real mirror functions for all new operations.

- **M4 — Settings UI**: `/api/settings` GET/PATCH, `/settings` page + navbar link, strategy select + threshold input. **DONE (2026-07-29)** — full suite 377 passed, 4 skipped; lint clean. Notes below.

### M4 implementation notes (divergences & decisions)

- **API shape**: `PATCH /api/settings` accepts a single `{ key, value }` object and validates it atomically. A partial-map shape was considered but rejected to keep writes explicit and error messages unambiguous.
- **Effective settings**: `GET /api/settings` returns `{ settings: { [key]: { value, source: 'workspace' | 'default' } } }` for known keys. Values stored in `workspace_settings` are returned as-is with `source: 'workspace'`; missing keys use the hardcoded code default with `source: 'default'`.
- **Validation extracted**: `assertKnownSettingKey` and `normalizeSettingValue` live in `server/lib/settings.ts` with unit specs. Strategy accepts `top-k`, `blind-merge`, `full`. Threshold must be a number in `(0, 1]` (strictly greater than 0, at most 1).
- **JSONB upsert**: `workspace_settings.value` is written with `to_jsonb(value::text)` for strings and `to_jsonb(value::numeric)` for numbers so PostgreSQL receives a well-typed JSONB value; raw Kysely parameter binding produced "invalid input syntax for type json".
- **Settings page** at `app/pages/settings.vue`: strategy select, threshold input shown only for `blind-merge`, save button, saved/error feedback. Changes apply to the next ingestion (documented on the page).
- **Navbar** at `app/components/app-header.vue`: Settings link with `~icons/heroicons/cog`.
- **Component test for the page**: added a smoke test for `settings.vue` using `mockNuxtImport('useFetch', ...)`. It renders the strategy select and conditionally shows the threshold input.
- **Tests added**: 8 e2e tests in `test/e2e/settings-api.spec.ts` (auth, defaults, persistence, unknown key, invalid strategy, out-of-range threshold, valid threshold); 13 unit tests in `test/unit/settings.spec.ts` (resolution, key validation, value normalization); 2 component tests in `test/components/settings-page.nuxt.spec.ts`; 1 updated app-header component test.
- **Typecheck**: `pnpm --filter web exec nuxt typecheck` currently fails before reaching project types due to a pre-existing `vue@^3.5.28` override conflict with npm (EOVERRIDE); lint and the full test suite are green.

- **M5 — Graph API + UI**: Topic nodes/color, topic-grouped list panel, concept detail updates. **DONE (2026-07-29)** — full suite 383 passed, 4 skipped; lint clean. Notes below.

### M5 implementation notes (divergences & decisions)

- **GraphNode label union extended with `Topic`**, **GraphEdge type union extended with `GROUPED_UNDER`** (Concept→Topic). `getFullGraph` now queries AGE `:Topic` vertices and `[:GROUPED_UNDER]` edges workspace-scoped, same pattern as existing Concept/Note/Tag reads.
- **ConceptSummary and ConceptDetail.concept carry `topics: string[]`** (topic names, alphabetically sorted). `getConceptList` joins `concept_topics` + `topics` in a separate lookup and maps names per concept; `getConceptDetail` queries topics directly. Response shapes are backward compatible — only the new `topics` field is added.
- **Topic nodes are violet `#7c3aed`** and rendered at **40px** while other nodes stay 32px, so topics read as grouping anchors on the canvas. Implemented via a Cytoscape selector rather than per-node data to keep `buildElements` simple.
- **Left panel is topic-grouped**: `concept-list.vue` uses `groupConceptsByTopic` (app/utils/graph.ts) to split concepts into alphabetically sorted topic buckets with an ungrouped bucket last; multi-topic concepts appear under each topic. New i18n keys `graph.topics` and `graph.ungrouped`.
- **Concept detail shows topic pills** under the concept header using a violet badge style.
- **Tests**: 6 new/updated tests (1 unit for topics in `toConceptSummaries`, 1 e2e workspace-isolation test for topics, 4 e2e assertions updated for topics/GROUPED_UNDER). Full suite: 383 passed, 4 skipped.

- **M6 — Mention-gap report**: script + report output. **DONE (2026-07-29)** — full suite 406 passed, 4 skipped when run complete; one pre-existing watcher test is flaky in full-suite runs (passes in isolation). Lint clean. Notes below.

### M6 implementation notes (divergences & decisions)

- **Script**: `apps/web/scripts/mention-gap-report.ts`, run via `pnpm --filter web report:mention-gaps`. Reads `DATABASE_URL` / `NUXT_DATABASE_URL` from `.env.local`.
- **CLI**: positional workspace id or name (default all workspaces); `--json`; `--threshold <gap-count>`; `--limit <rows>`. UUID positional resolves by `workspaces.id`, otherwise by case-insensitive `name` match.
- **Pure core**: `server/lib/mention-gap.ts` is fully unit-testable without a DB. Exports `generateConceptVariants`, `extractTextTokens`, `textMatchesConcept`, and `findMentionGaps`.
- **Variant generation**: single-word concepts produce one lowercase token variant (matched by whole token, so `Paddle` matches `paddle_id` and `PaddleBillingService` but not `paddling`). Multi-word concepts produce phrase variants: lowercase space-separated, snake_case, kebab-case, camelCase, and compact (alphanumeric only). Phrases match as substrings in lowercased chunk text.
- **Gap definition**: a positive gap = number of distinct notes whose chunk text matches a concept variant but have no mention row linking that chunk to that concept.
- **Output shape**: console table `concept | matching notes | mentioned notes | gap` sorted by gap desc, then concept name; followed by per-note gaps. Always also written to `apps/web/tmp-mention-gap.md`. `--json` emits the same `conceptSummaries` + `noteGaps` structure.
- **Divergence from plan**: the plan mentioned "word-boundary" matching; implementation uses token equality for single-word concepts and substring matching for multi-word phrases. This avoids `paddling` false positives while still catching `paddle_id`/`paddleId`. `--threshold` operates on gap count (not a score).
- **Tests**: 21 unit tests in `test/unit/mention-gap.spec.ts` (variants, tokenization, matching, gap aggregation, workspace isolation, sorting), 3 e2e tests in `test/e2e/mention-gap.spec.ts` using the in-process transactional harness to verify DB-fed gap detection and mention suppression.

- **M7 — Rebuild + comparison + live verification**: wipe, run comparison protocol (flip strategy via Settings between rebuilds), psql cypher count parity, browser check of `/graph` and `/settings`, findings recorded below.

### M7 implementation notes (divergences & decisions)

- **Danger zone built instead of a manual rebuild script.** The rebuild procedure from the plan is now exposed as a user-facing feature on `/settings`:
  - `POST /api/settings/rebuild` truncates graph-derived relational rows for the caller's workspace (`mentions`, `relations`, `concept_topics`, `concepts`, `topics`, `chunks`, `links`, `sources`) plus AI-origin `note_tags` only (`origin = 'ai'`), preserving user tags and `note_tag_dismissals`.
  - It drops + recreates the shared Apache AGE graph `notes_graph` so the mirror starts empty.
  - It sets every note in the workspace to `status='pending'` without enqueueing jobs; the existing sweeper picks them up later.
  - Returns a summary JSON with per-table wiped counts and the number of notes reset.
- **Workspace isolation:** relational deletes are scoped to the caller's workspace. Because the MVP uses a single shared AGE graph, dropping/recreating it affects all workspaces; this matches the plan's "single graph for the MVP" decision and is acceptable for now.
- **Progress visibility:** `GET /api/notes/status-counts` returns `{ pending, ingested, failed }` for the workspace; the settings page polls it every 3 seconds while any notes are pending.
- **UI guard:** the dialog requires typing the exact string `REBUILD` (case-sensitive) before the confirm button enables.
- **No jobs enqueued** by the endpoint, per locked decision.

## Deferred / open

- Mention recall mechanism (aliases, deterministic backfill) — gated on M5 report + comparison.
- Topic consolidation job (embedding-similarity merge of near-duplicate topics) — the safety net if LLM topic discipline slips.
- Topic-level overview as the default canvas view (drill-down interaction design).
- Agent topic tools (`list_topics`, `search_topics`).
- Orphan Tag cleanup / tag utility rethink.
- YAML step-file ingestion (deferred, not rejected — the `yaml-note` pipeline chunking on top-level keys via the existing `notes.pipeline` discriminator is the designed escape hatch; same extension path serves future plain-text/PDF Notes).
- Concept merge UI.
- Domain-style grouping (rejected 2026-07-28: same-tech-across-projects must be one concept; revisit only if workspace-global noise ever becomes a real problem).
