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

- **M1 — Schema**: `topics`, `concept_topics`, `workspace_settings`, HNSW indexes. Regenerate types + schema dump.
- **M2 — Extraction seam + strategies**: `VocabularyStrategy` interface + registry, topic schema + prompt rules, top-K retrieval via chunk-embedding centroid, blind-merge vocabulary omission, settings resolution (workspace setting → code default), tolerant topic parsing, unit + stage specs.
- **M3 — Store-graph**: topic resolution/embed/upsert, `concept_topics`, blind-merge similarity pass with audit logging, AGE mirror helpers, atomic transaction extended.
- **M4 — Settings UI**: `/api/settings` GET/PATCH, `/settings` page + navbar link, strategy select + threshold input.
- **M5 — Graph API + UI**: Topic nodes/color, topic-grouped list panel, concept detail updates.
- **M6 — Mention-gap report**: script + report output.
- **M7 — Rebuild + comparison + live verification**: wipe, run comparison protocol (flip strategy via Settings between rebuilds), psql cypher count parity, browser check of `/graph` and `/settings`, findings recorded below.

## Deferred / open

- Mention recall mechanism (aliases, deterministic backfill) — gated on M5 report + comparison.
- Topic consolidation job (embedding-similarity merge of near-duplicate topics) — the safety net if LLM topic discipline slips.
- Topic-level overview as the default canvas view (drill-down interaction design).
- Agent topic tools (`list_topics`, `search_topics`).
- Orphan Tag cleanup / tag utility rethink.
- YAML step-file ingestion (deferred, not rejected — the `yaml-note` pipeline chunking on top-level keys via the existing `notes.pipeline` discriminator is the designed escape hatch; same extension path serves future plain-text/PDF Notes).
- Concept merge UI.
- Domain-style grouping (rejected 2026-07-28: same-tech-across-projects must be one concept; revisit only if workspace-global noise ever becomes a real problem).
