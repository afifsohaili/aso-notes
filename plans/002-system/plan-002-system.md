# Plan 002 — Agentic Graph-RAG Personal Notes: System Implementation

Status: decisions locked via grilling (2026-07-23). Ready to build.
Glossary: see `CONTEXT.md`. Product context: see `product.md`.

## Goal

Single-user (multi-tenant-ready) personal knowledge assistant. Notes sync from a local folder,
get chunked + embedded + entity-extracted into a relational store mirrored to Apache AGE,
and are queried through an agentic RAG chat with tool access to both vector and graph retrieval.

## Locked tech choices

- **DB**: Postgres 16 (Docker, port 5433) with pgvector 0.8.0 + Apache AGE 1.5.0
- **LLM**: OpenRouter — `deepseek/deepseek-v4-flash` (chat/extraction), `nvidia/llama-nemotron-embed-vl-1b-v2:free` (embeddings). Verify embedding dimension from model card before writing the vector columns (fact lookup, not a decision).
- **Providers as strategy interfaces**: chat, embedding, extraction all behind contracts; OpenRouter is the first implementation.
- **Background work**: BullMQ (existing queue/worker pattern), Nitro server plugins for in-process daemons.

## Architecture

```
notes/ (disk, source of truth)
  │ chokidar (Nitro plugin: notes-sync)
  ▼
notes table upsert (immediate)  ──status=pending──►  sweeper (30s)
                                                       │ settled 5 min
                                                       ▼
                                              BullMQ ingestion job
                                                       │
                              Pipeline (stage registry, per-note pipeline)
                              resolveCovers → chunk → embed → extract → store
                                                       │
                                one transaction: relational + AGE mirror
                                                       ▼
Agent (Nitro route, tool-calling loop, SSE) ◄── relational tables + AGE graph
```

## Data model (relational, source of truth)

All tables carry `workspace_id` (multi-tenant-ready). IDs uuid with `gen_random_uuid()` unless noted.

| Table | Columns | Notes |
| ----- | ------- | ----- |
| `folders` | id, workspace_id, path (unique per workspace), cover_content, cover_hash, timestamps | Path-string model, no parent_id. Cover = `__folder-cover.md`, never a Note. |
| `notes` | id, workspace_id, folder_id FK, path (unique per workspace), title, content, content_hash, ingested_hash, status (`pending`\|`ingested`\|`failed`), pipeline, timestamps | `pipeline` = pipeline discriminator. status drives sweeper. |
| `chunks` | id, workspace_id, note_id FK, seq, text, token_count, embedding halfvec(2048), timestamps | Wipe+rewrite per ingestion. HNSW index on embedding. |
| `concepts` | id, workspace_id, name, name_normalized (unique per workspace), description, embedding halfvec(2048), timestamps | name_normalized = lowercase, collapse whitespace/punct. HNSW on embedding. |
| `relations` | id, workspace_id, from_concept_id FK, to_concept_id FK, type, description, timestamps | type = free-text label from LLM. |
| `mentions` | id, workspace_id, chunk_id FK, concept_id FK, unique(chunk_id, concept_id) | Chunk-level. Cascade delete via chunks. |
| `tags` | id, workspace_id, name, name_normalized (unique per workspace), timestamps | |
| `note_tags` | note_id FK, tag_id FK, origin (`user`\|`ai`), unique(note_id, tag_id) | Re-ingestion replaces only origin='ai', respecting dismissals. |
| `note_tag_dismissals` | note_id FK, tag_id FK, created_at | Written when user removes an AI tag; blocks re-adding. |
| `links` | id, workspace_id, from_note_id FK, to_note_id FK (nullable), raw_target, timestamps | Dangling links keep raw_target; re-resolved when target note appears. |
| `sources` | id, workspace_id, note_id FK, url, url_normalized, title, type, timestamps | type derived from host (youtube/tiktok/web). Dedup key (note_id, url_normalized). |
| `conversations` | id, workspace_id, title, timestamps | Title from first ~60 chars of first query. |
| `messages` | id, workspace_id, conversation_id FK, role (`user`\|`assistant`\|`tool`), content, tool_calls jsonb, tool_call_id, created_at | OpenAI-style; full replay of agent runs. |

## AGE graph (derived mirror, same transaction)

- Graph name: `notes_graph` (per-database; workspace scoping via `workspace_id` property on every node/edge + application-level filtering).
- Nodes: `(:Concept {id, workspace_id, name})`, `(:Note {id, workspace_id})`, `(:Tag {id, workspace_id, name})`
- Edges: `[:RELATES_TO {type, workspace_id}]` (Concept→Concept), `[:MENTIONS {workspace_id}]` (Note→Concept), `[:TAGGED {workspace_id}]` (Note→Tag), `[:LINKS {workspace_id}]` (Note→Note)
- **Mirror rule**: any relational write to a graph-mirrored table carries its AGE mirror in the same transaction — ingestion store stage AND UI tag edits alike. Shared helpers (`mirrorTagEdge`, `mirrorNoteNode`, …), no scattered cypher strings.
- Relational handles: lists, counts, filters, FK integrity. AGE handles: `find_paths_between`, multi-hop neighbor expansion, graph viz data.

## Sync service

Nitro plugin `apps/web/server/plugins/notes-sync.ts`, chokidar on `NUXT_NOTES_DIR` (default `./notes`).

1. chokidar events are per-file (`add`/`change`/`unlink`); startup scan fires `add` per existing file → restart recovery.
2. **Fast path (immediate)**: upsert/delete `notes` row (path, content, content_hash). If `content_hash != ingested_hash` → `status='pending'`.
3. **Slow path (settle detection)**: sweeper every 30s — `SELECT … WHERE status='pending' AND updated_at < now() - interval '5 minutes'` → enqueue BullMQ ingestion job.
4. **Renames**: `unlink` + `add` with matching content_hash → update path, keep row + all derived data, no re-ingestion.
5. `__folder-cover.md` files never become Notes: sync stores content on `folders.cover_content`/`cover_hash`. Cover change → all descendant notes (by path prefix) → `status='pending'`.
6. Links/sources/tags parsed at ingestion, not at sync.

## Ingestion pipeline

**Framework**: `Stage` interface `invoke(ctx: PipelineContext)`; string-ID constants (`export const RESOLVE_COVERS_STAGE = 'resolve-covers'`); singleton `StageRegistry` with constructor-injected deps at boot; stages stateless (all mutable state in `PipelineContext`); pipelines as `Record<PipelineId, StageId[]>`; **boot-time validation** that every stage ID in every pipeline resolves. `PipelineContext` = mutable bag with optional fields (note, mergedCovers, content, chunks, embeddings, extraction).

**Default pipeline `markdown-note`**: `resolve-covers → chunk-markdown-aware → embed-chunks → extract-graph → store-graph`
Future example: `youtube-transcript`: `prettify-transcript → resolve-covers → chunk-markdown-aware → embed-chunks → extract-graph → store-graph`

**Stage semantics**:
- `resolve-covers`: nearest-ancestor cover merge, root→leaf order, 4-level cap.
- `chunk-markdown-aware`: split on headings; sections > ~500 tokens subdivide at paragraph boundaries with 1–2 sentence overlap; tiny notes = single chunk. Non-markdown fallback: fixed ~500-token windows, 15% overlap.
- `embed-chunks`: batched embed of `mergedCovers + chunk text`.
- `extract-graph`: whole-note structured call (fallback per-section if > ~8k tokens). Prompt: merged covers + full note text + note's tags (vocabulary hints) + **full existing concept-name list** (reuse instruction). Structured output: `{ concepts: [{name, description}], relations: [{from, to, type}], mentions: [{concept, chunkRefs[]}] }`.
- `store-graph`: phase 1 read-only concept resolution (existing vs new via name_normalized); phase 2 batched embed of NEW concepts (`"name: description"`); phase 3 one transaction — wipe+rewrite chunks/mentions/links/sources, upsert concepts (with embeddings), insert relations, dedupe ai-tags, AGE mirror, mark `ingested_hash`, `status='ingested'`.

**Failure model**: atomic per note per content version; job retries restart from the top; nothing persists before the final transaction; hallucinated chunk refs dropped + logged.

## URL normalization (Sources)

Store `url` (raw) + `url_normalized` (canonical). Rules: lowercase scheme/host; strip `www.`; strip fragment; strip trailing slash; strip query params except per-host keep-list (`youtube.com`: keep `v`); rewrite `youtu.be/ID` → `youtube.com/watch?v=ID`. Host-rules map in `url-normalizer.ts`; table-driven unit tests.

## Agent

- **Loop**: tool-calling loop in `server/api/query.post.ts` (in-process, NOT a BullMQ job — interactive). Named constant `MAX_TOOL_ITERATIONS = 10`. On cap: inject wrap-up system prompt ("summarize what you found, list what you couldn't finish") + one tools-disabled final call. Doom-loop detection deferred.
- **Transport**: SSE from the query route. Events: `tool_call {name, args}` → `tool_result {name, summary}` → `answer {text, notes[]}`. No token streaming (MVP).
- **Tool registry**: `{ name, schema, invoke(args, deps) }`, same registry pattern as stages.
- **Tools** (locked): `search_notes` (vector over chunks), `search_concepts` (vector over concept embeddings, cosine + HNSW), `get_concept_neighbors`, `get_mentions` (returns chunks grouped by note), `read_note`, `find_paths_between` (AGE), `search_sources`.
- **Memory**: conversation-scoped only. Context = current conversation's messages. No cross-conversation memory.

## UI

- **Chat (`/`)**: home. Query box, SSE agent activity log, Answer + linked notes, conversation sidebar.
- **Notes (`/notes`)**: folder tree, note view (content, ingestion status, tags add/remove, extracted concepts). In-app editor = plain markdown textarea writing to disk (chokidar picks it up — no special integration).
- **Graph (`/graph`)**: Cytoscape.js + `fcose` layout; node-type styling (Concept/Note/Tag); concept list side panel; click node → neighbors/mentions.

## Build order

- **M1 — Schema**: migrations for all tables + AGE graph creation + indexes (vector HNSW, name_normalized uniques, pg_trgm not needed). Regenerate types + schema dump. **DONE (2026-07-24)** — migration `1784859182887_create_notes_domain.ts`, spec `apps/web/test/e2e/notes-schema.spec.ts` (11 tests). Notes below.

### M1 implementation notes (divergences & decisions)

- **Embedding dimension verified: 2048** — `nvidia/llama-nemotron-embed-vl-1b-v2` outputs a single 2048-dim embedding (model card: https://huggingface.co/nvidia/llama-nemotron-embed-vl-1b-v2).
- **`halfvec(2048)` instead of `vector(2048)`** for `chunks.embedding` / `concepts.embedding`: pgvector HNSW caps `vector` at 2000 dimensions; `halfvec` allows 4000. HNSW indexes use `halfvec_cosine_ops`. **M2+ must cast embedding literals to `halfvec`** on insert and query (`'[...]'::halfvec`).
- **DB image rebuilt** (`docker/postgres/Dockerfile`): the previous third-party image (`marcosbolanos/pgvector-age`) segfaulted Postgres on ANY vector index build (HNSW and IVFFlat, any dimension). Now `postgres:16-bookworm` + pgvector `v0.8.0` + AGE `PG16/v1.5.0-rc0` compiled from pinned sources. Existing data volume is compatible (same PG major).
- **`notes.folder_id` nullable, ON DELETE SET NULL** — plan didn't specify; path strings are the identity model, root notes have no folder row, and losing a folder row must not destroy notes.
- **`messages.workspace_id` added** (not in the plan's column list) per the blanket tenant rule; `messages.role` got a CHECK constraint (`user|assistant|tool`) like `notes.status` / `note_tags.origin`.
- **`note_tags` / `note_tag_dismissals` use composite PKs `(note_id, tag_id)`** (no surrogate id, per plan column lists); `mentions` has a surrogate id and no timestamps, per plan.
- **e2e provisioning caveat**: the test template DB loads `db/schema.sql` (`pg_dump --schema-only`), which carries the `notes_graph` schema + label tables but NOT the `ag_catalog.ag_graph` row (catalog data). `notes-schema.spec.ts` backfills that row idempotently (`graphid` = the graph namespace's `pg_namespace.oid`) — reuse this pattern if future specs need the AGE catalog.
- **M2 — Pipeline framework + AI strategy**: Stage/Registry/Context, boot validation, OpenRouter chat+embed clients behind interfaces, BullMQ ingestion queue registration. **DONE (2026-07-24)** — pipeline framework in `apps/web/server/lib/pipeline/`, AI providers in `apps/web/server/lib/ai/`, 60 unit + 7 new e2e tests. Notes below.

### M2 implementation notes (divergences & decisions)

- **Module layout**: `server/lib/pipeline/{types,context,ids,registry,run-pipeline,singleton,chunker,url-normalizer}.ts` + `server/lib/pipeline/stages/*.ts`; `server/lib/ai/{types,index,openrouter-embedding,openrouter-llm}.ts`. Stage-ID constants and `PIPELINES` live together in `ids.ts`.
- **`PipelineContext`** carries `{ note, workspaceId, db }` (db = Kysely|Transaction, so stages run inside the test trx and inside M4's final transaction), plus mutable `coverChain?`, `chunks?`, `extraction?`, and `extra` bag with `setOutput`/`getOutput` (extract-sources writes `sources`, extract-links will write `links`).
- **`runPipeline(pipelineId, ctx, options?)`** — optional `{ registry, pipelines }` override for tests; defaults to the lazy singleton from `singleton.ts` (`getStageRegistry()`, built via `createStageRegistry(deps)` which registers all stages and runs boot validation immediately).
- **Two pipelines registered**: `markdown-note` (resolve-covers → chunk-markdown-aware → embed-chunks → extract-graph → store-graph) and `markdown-note-with-links` (… → extract-graph → extract-links → extract-sources → store-graph). `extract-graph`, `extract-links`, `store-graph` are **no-op placeholders until M4** (extract-links is M4: links are persisted by store-graph's wipe+rewrite phase, which is M4 scope). `extract-sources` is fully implemented (writes to ctx only; persistence is M4).
- **Cover-chain depth cap**: `MAX_COVER_CHAIN_DEPTH = 4` counts the note's own folder as level 1 (nearest 4 levels win). Walk is a recursive CTE trimming one path segment per step (path-string model, no parent_id); start path = note's folder via `folder_id`, falling back to dirname of `note.path` (root notes → `/`).
- **Chunker**: ~500-token target, `tokenizer: 'approx'` (4 chars/token). Merged chunk carries the most specific (last) section's heading path. Section subdivision overlap = 1 sentence, carried only if ≤ 25% of target. Non-markdown fallback (zero ATX headings) = fixed 2000-char windows, 15% (300-char) overlap. Empty doc → zero chunks.
- **Embedding input** per chunk: `coverChain + '\n\n' + headingPath.join(' > ') + '\n\n' + chunk.text` (missing parts omitted). Batches of ≤100; every embedding validated for dim 2048 (`EMBEDDING_DIMENSIONS`) and count parity with inputs.
- **`LLMProvider` signature** (M5 needs this): `complete(request: CompletionRequest): Promise<CompletionResult>` where `CompletionRequest = { messages: ChatMessage[], tools?: ToolDefinition[], toolChoice?: 'auto'|'none', responseFormat?: { type:'json_object' } | { type:'json_schema', jsonSchema: { name, schema, strict? } }, maxTokens?, temperature? }`, `ChatMessage = { role: 'system'|'user'|'assistant'|'tool', content: string|null, toolCalls?: ToolCall[], toolCallId?: string }`, `ToolCall = { id, name, arguments: string }` (JSON-encoded, OpenAI wire format), `CompletionResult = { message: ChatMessage, usage?: { promptTokens, completionTokens } }`.
- **OpenRouter providers**: fetch-based, `fetchFn` injectable (no live calls in tests); embeddings sorted by `index` before return; non-OK responses throw `Error` with status + body. Factories `createEmbeddingProviderFromEnv` / `createLLMProviderFromEnv` read `NUXT_OPENROUTER_API_KEY` / `NUXT_OPENROUTER_CHAT_MODEL` / `NUXT_OPENROUTER_EMBEDDING_MODEL` (added to `nuxt.config.ts` runtimeConfig), defaults `deepseek/deepseek-v4-flash` + `nvidia/llama-nemotron-embed-vl-1b-v2:free`.
- **BullMQ ingestion queue registration deferred to M3** (plan listed it under M2, but no worker enqueues ingestion jobs until the sync sweeper exists).
- **Pre-existing fixes**: `test/unit/todos.schema.spec.ts` now tolerates a missing `.env.local` (was failing in this repo before M2).
- **M3 — Sync**: chokidar plugin, upsert fast path, sweeper, rename guard, folder-cover handling. Chunk+embed stages live; extraction stubbed → notes searchable end-to-end. **DONE (2026-07-24)** — sync service in `apps/web/server/lib/sync/`, plugins `notes-sync.ts` + `ingestion-worker.ts`, 21 new unit + 19 new e2e tests. Notes below.

### M3 implementation notes (divergences & decisions)

- **Module layout**: `server/lib/sync/{paths,hash,upsert-decision,files,dispatcher,sweeper,ingest,watcher,workspace}.ts`. Pure seams (`paths`, `hash`, `decideUpsert`, dispatcher selection, sweeper query builder) are unit-tested; DB handlers are e2e-tested by driving `handleFileUpsert`/`handleFileUnlink`/`startupScan` directly against a temp notes dir, plus one real chokidar smoke spec (`test/e2e/notes-watcher.spec.ts`).
- **Dispatcher interface**: `IngestionDispatcher { dispatch(noteId): Promise<void> }`. `createSyncDispatcher({ redisUrl, createQueue?, inlineRun? })` → BullMQ producer when `NUXT_REDIS_URL` is set (queue `ingestion`, job `ingest-note`, constants `INGESTION_QUEUE_NAME`/`INGEST_NOTE_JOB`), inline handler when provided (tests), else `null` → sweeper skipped with a single boot log. The `@base/testing` queue facade is NOT used — the dispatcher seam is stubbed directly.
- **Worker**: `apps/web/server/plugins/ingestion-worker.ts` (mirrors email-worker), starts only when `NUXT_REDIS_URL` is set, concurrency 2. Handler `ingestNote({ db, noteId, options? })` loads the note, runs `runPipeline`, sets `status='ingested'` + `ingested_hash=content_hash` on success, `status='failed'` on throw and rethrows for BullMQ retry. **The M1 schema has no error column** — failures are logged and visible via BullMQ failed-job retention; no `last_error` on notes.
- **M4 handoff**: the worker's post-run status/`ingested_hash` write is idempotent with the store-graph stage's planned final-transaction write — M4 should move that write into store-graph.
- **Workspace resolution**: single-tenant MVP — `resolveSyncWorkspace` picks the first workspace by `created_at`. If none exists, the plugin logs and disables sync.
- **Rename guard**: `add` with a `content_hash` matching a row at a different path UPDATEs path/folder_id/title (status, ingested_hash, links, derived data preserved — no re-ingestion). `unlink` deletes are grace-delayed by `UNLINK_GRACE_MS = 1000` (injectable) so both event orderings resolve through the guard; a true delete cascades via FKs (chunks/mentions/links/sources/note_tags).
- **Skip rule extended**: unchanged content skips when `content_hash` matches too (not only `ingested_hash`) so restart scans don't reset the sweeper settle clock.
- **Root folder row**: `/` is created only when a root `__folder-cover.md` exists (its cover needs a home and resolve-covers walks up to `/`); root notes keep `folder_id = null` per M1.
- **Covers**: stored on `folders.cover_content`/`cover_hash`; change cascades `status='pending'` to descendants by path prefix (root cover → all notes); unchanged cover is a no-op. Cover DELETE clears the cover and cascades (plan was silent).
- **Startup scan**: chokidar runs with `ignoreInitial: true`; an explicit `startupScan` on `ready` replays the same per-file upsert for every disk file, deletes DB notes whose files vanished, and clears covers whose file vanished (plan's "startup scan fires add per existing file" is subsumed by this).
- **Config**: `runtimeConfig.notesDir` (`NUXT_NOTES_DIR`), default `./notes` resolved from the process cwd; the dir is created at boot. `NUXT_DISABLE_NOTES_SYNC=1` kill-switch added to the built-server test harness (same pattern as the email worker).
- **chokidar 4** added as a dependency; watch filters in code (v4 dropped glob support): `*.md` only, ignoring `node_modules` and dotfiles.
- **M4 — Extraction + graph**: extract-graph stage, store-graph with concept resolution + concept embeddings, AGE mirror helpers. **DONE (2026-07-24)** — extraction (`extract-graph`, `extract-links`, `extraction.ts`, `links.ts`), store-graph (`store-graph.ts`), and AGE helpers (`server/lib/graph/age.ts`, `helpers.ts`) with specs `ingest-graph.spec.ts`, `extract-graph-stage.spec.ts`, `extraction.spec.ts`, `links.spec.ts`. Notes below.
### M4 implementation notes (divergences & decisions)

- **Module layout**: `server/lib/pipeline/extraction.ts` (prompt assembly + tolerant parsing), `server/lib/pipeline/links.ts` (wikilink/markdown link parsing + candidate resolution), `server/lib/pipeline/stages/{extract-graph,extract-links,store-graph}.ts`, and `server/lib/graph/{age.ts,helpers.ts,index.ts}`.
- **Whole-note extraction (`extract-graph`)**: one structured LLM call with `json_schema` response format; prompt includes the cover chain, enumerated chunks, the workspace's full existing concept list (name + description), and existing tag names. `parseExtraction` drops invalid chunk refs, malformed entries, and empty names rather than failing the whole note.
- **Link extraction (`extract-links`)**: wikilinks `[[...]]` (with aliases/heading fragments stripped) and internal markdown links; absolute targets resolve from root, relative targets from the note's folder then root; extensionless targets try `.md`. Dangling links keep `raw_target` and a `null` `to_note_id` for later re-resolution.
- **Store-graph final transaction**: wipes/rewrites note-derived rows (`chunks`, `mentions`, `ai` `note_tags`, `links`, `sources`), upserts concepts by `(workspace_id, name_normalized)`, batch-embeds genuinely new concepts, inserts relations/mentions, handles AI tags with `note_tag_dismissals` respect, persists links/sources, mirrors the subgraph into AGE, and sets `status='ingested'` + `ingested_hash` — all in one transaction. The worker now only writes `status='failed'` on error and rethrows for retry; it does not write `status='ingested'` or `ingested_hash`.
- **Status-write contract**: `store-graph` owns the final status flip. Stubs or alternate pipelines that replace `store-graph` and still want to assert `status='ingested'` must write the flip themselves (e.g. the sweeper specs now use a `mark-ingested` stub stage). The `ingest-graph` atomicity test required the target note to be present so the link resolved and the late-failing mirror was actually exercised.
- **AGE id strategy**: graph nodes use the relational UUID as the `id` property and are MERGEd by it. Every node/edge carries `workspace_id`. `RELATES_TO` edges also carry the LLM-provided `type` property.
- **Cypher helper API**: `age.ts` provides `executeCypher`/`queryCypher` with `LOAD 'age'` + `SET LOCAL search_path` per call, `agLiteral`/`agProperties`/`agValue` for value interpolation, and `parseAgtype` for results. `helpers.ts` exposes typed `merge*Node`/`merge*Edge` functions and `wipeNoteEdges`/`conceptNeighbors`.
- **AGE edge-property quirk**: `MERGE (a)-[r:TYPE]->(b) SET r.prop = ...` without a `RETURN` clause silently drops the edge property (the `SET` is ignored). Fix: inline edge properties in the MERGE clause (`MERGE (a)-[r:TYPE {workspace_id: ..., type: ...}]->(b)`). Node `SET` is unaffected.
- **Neighbor query quirk**: `length(r)` on a variable-length edge list fails in AGE 1.5 with `length() argument must resolve to a scalar`. Fix: use a path variable `MATCH p=(a)-[:RELATES_TO*1..n]-(b)` and `min(length(p))`.
- **Link edge target nodes**: `store-graph` MERGEs the target `Note` vertex before creating a `LINKS` edge, because AGE edge creation requires both endpoints to exist; the source `Note` node is already MERGEd at the start of the stage.

- **M5 — Agent**: tool registry + 7 tools, loop with cap + wrap-up, SSE route, messages persistence. **DONE (2026-07-24)** — agent module in `apps/web/server/lib/agent/`, routes `apps/web/server/api/conversations/`, 27 new e2e tests. Notes below.
- **M6 — Chat UI**: conversation sidebar, query box, SSE activity log, answer + citations. **DONE (2026-07-26)** — UI components in `apps/web/app/components/chat/`, routes `apps/web/app/pages/chat/index.vue` and `/` redirect, SSE parser `apps/web/app/utils/chat-sse.ts`, `useChat` composable. Notes below.
- **M7 — Notes UI**: folder tree, note view, tag management, in-app editor. **DONE (2026-07-24)** — UI components in `apps/web/app/components/notes/`, routes `apps/web/server/api/folders/` and `apps/web/server/api/notes/`, page `apps/web/app/pages/notes/index.vue`, e2e + component + unit tests. Notes below.
- **M8 — Graph UI**: Cytoscape canvas + concept list panel. **DONE (2026-07-25)** — UI components in `apps/web/app/components/graph/`, routes `apps/web/server/api/graph/`, backend helpers `apps/web/server/lib/graph/ui.ts`, e2e + component + unit tests. Notes below.
- **M9 — End-to-end live verification + fixes**: full loop against real infra (dev DB, Redis, OpenRouter) with a fresh UI signup, watcher/startup-scan sync, sweeper/worker ingestion, and browser verification of Notes/Graph/Chat. **DONE (2026-07-26)** — loop verified end-to-end; five bugs found and fixed (TDD), suite green (287 passed across unit/e2e/nuxt), lint clean. Notes below.

### M9 implementation notes (divergences & decisions)

- **Verification flow**: truncated dev DB + recreated `notes_graph`; signed up via `/signup` (Turnstile skipped in dev) → workspace + admin membership auto-created; restarted the dev server so the notes-sync plugin resolves the workspace at boot (documented M3 limitation); startup scan synced 6 sample notes; ingestion via manual BullMQ dispatch (the 5-minute settle constant was respected, not shortened); verified chunks+embeddings, concepts/relations/mentions/tags/links/sources, and the AGE mirror via psql cypher (counts match relational exactly); Notes UI (tree, ingested status, tags, sources, edit → pending → re-ingested); Graph UI (canvas, concept list, concept detail with neighbors/mentions); Chat UI (SSE activity log, accurate streamed answers, cited-note deep-links, follow-up with conversation memory, sidebar persistence across reload).
- **Bug 1 — workspace not auto-created on signup** (root cause): the `after` auth middleware relied on `ctx.context.newSession`, which is null when email verification is required, so the hook never ran. Fixed by moving workspace+membership creation into `databaseHooks.user.create.after` in `apps/web/utils/auth.ts` (runs regardless of session state). Test: `test/e2e/auth-signup.spec.ts`. `packages/testing/src/auth.ts` `givenVerifiedUser` updated to reuse the auto-created workspace instead of always inserting its own.
- **Bug 2 — email verification impossible in dev**: `requireEmailVerification: true` hardcoded while no Brevo key is configured, so a UI signup could never log in locally. Now `requireEmailVerification: process.env.NODE_ENV !== 'development'` in `apps/web/utils/auth.ts`.
- **Bug 3 — ingestion worker crashed on every job** (root cause): `server/plugins/ingestion-worker.ts` called `useDatabase` without importing it (`utils/db` is not Nitro-auto-imported from server code). Every BullMQ ingestion job failed 3 attempts with `useDatabase is not defined`. Fixed by adding the explicit import. (Plugin-level import errors are only observable live; verified via successful ingestion of all 6 notes.)
- **Bug 4 — synced notes never extracted links/sources** (root cause): `notes.pipeline` DB-defaulted to `markdown-note`, which omits `extract-links`/`extract-sources`; nothing ever assigned `markdown-note-with-links`, so wikilinks and external URLs never produced `links`/`sources` rows in real sync flow. Fixed: sync now sets `pipeline: 'markdown-note-with-links'` on insert and upgrades it on content update (`server/lib/sync/files.ts`). Tests: two new cases in `test/e2e/notes-sync.spec.ts`. Live re-ingestion produced the expected `links` row (`/ideas/ideas.md` → `/project-a/plan.md`) and `sources` row (YouTube URL).
- **Bug 5 — chat 400 "No models provided"** (root cause): nuxt runtimeConfig defaults `openrouterChatModel`/`openrouterEmbeddingModel` to `''`; the provider factories used `??`, so the empty string won over the defaults and OpenRouter received `model: ''`. Fixed in `server/lib/ai/index.ts`: empty strings now fall back to `DEFAULT_CHAT_MODEL`/`DEFAULT_EMBEDDING_MODEL`. Tests: two new cases in `test/unit/openrouter.spec.ts`.
- **Bug 6 — landing hero + CTA banner linked externally**: boilerplate leftover — hero CTA pointed at web3templates.com and the banner had a conflicting `to="/app"` (nonexistent route) + external `href`. Both now route to `/signup` via `NuxtLink`. Tests: two new cases in `test/components/landing-page.nuxt.spec.ts`. Verified live: hero CTA → `/signup`.
- **Lint**: `eslint` clean; also fixed a pre-existing `node/prefer-global/process` error in `server/lib/email.ts`.
- **Test result**: `287 passed` across 42 files (unit + e2e + nuxt projects). Known flake `test/e2e/notes-watcher.spec.ts` chokidar timing test failed once in the full run and passes in isolation — pre-existing, not a regression.
- **Model observations**: `deepseek/deepseek-v4-flash` produced accurate, well-cited answers and coherent concept/relation extraction (agentic UX relations: `is a type of`, `uses`, `requires`, `implements`); the free embedding model `nvidia/llama-nemotron-embed-vl-1b-v2:free` ingested all notes without rate-limit failures. OpenRouter 400 surfaced only because of Bug 5.
- **Cleanup**: verification data (user/workspace/conversations/notes-domain rows) removed from the dev DB, AGE graph dropped+recreated, dev server stopped. Sample dir keeps `ideas/agentic-ui.md` and `project-a/agent-features.md` (coherent permanent samples) plus a graph-traversal sentence added to `ideas/ideas.md` during the edit/re-ingestion check; the `ideas/new-idea.md` watcher-test artifact was removed.

### M8 implementation notes (divergences & decisions)

- **Module layout**: backend graph DTO helpers in `server/lib/graph/ui.ts` (`getFullGraph`, `getConceptList`, `getConceptDetail`); API routes `server/api/graph/index.get.ts`, `server/api/graph/concepts/index.get.ts`, `server/api/graph/concepts/[id].get.ts`; UI components `app/components/graph/{graph-canvas,concept-list,concept-detail}.vue`; page `app/pages/graph/index.vue`; nav link added to `app/components/landing-page/landing-page-header.vue`.
- **API surface**:
  - `GET /api/graph` → `{ nodes: { id, label, name, ref }[], edges: { source, target, type, edgeType? }[] }`; workspace-scoped via AGE cypher.
  - `GET /api/graph/concepts` → `{ id, name, description, mentionCount }[]` ordered by `mentionCount` desc.
  - `GET /api/graph/concepts/:id` → `{ concept: { id, name, description }, neighbors: { id, name, type, weight }[], mentionedIn: { path, title }[] }`.
- **AGE cypher quirks discovered**: `labels(n)` segfaults AGE 1.5 in the current Docker image; full-graph nodes are fetched by explicit label (`:Concept`, `:Note`, `:Tag`). Returning `r.type AS edgeType` from a `RELATES_TO` edge returns no value; the alias must be `type` (returned as `type` and then mapped to `edgeType` in DTO).
- **Relations have no `weight` column** in the M1 schema, although the M8 spec requested `weight` in neighbor output. API returns `weight: 1` as a placeholder; a future schema migration can add a real `weight` column.
- **Cytoscape client-only**: `graph-canvas.vue` renders only on the client via `<ClientOnly>` + dynamic imports to avoid SSR issues with `cytoscape`/`cytoscape-fcose`.
- **Note navigation**: clicking a Note node or a mentioned note in the detail panel navigates to `/notes` (with `?note=<path>` query on detail-panel clicks); the Notes page does not yet read that query parameter.
- **Browser verification**: logged in as seeded `graph-tester@example.com`, `/graph` rendered Cytoscape canvas with fcose layout, concept list populated, concept selection highlighted neighborhood and populated detail panel. Screenshots: `tmp-screenshots/login.png`, `tmp-screenshots/graph-page-loaded.png`, `tmp-screenshots/graph-concept-selected.png`, `tmp-screenshots/graph-note-navigate.png`, `tmp-screenshots/landing-header-graph-link.png`.
- **Test result**: full suite `272 passed | 4 skipped (276)` across 37 files. New specs: `test/e2e/graph-api.spec.ts` (6 tests), `test/unit/graph-ui.spec.ts` (5 tests), `test/components/graph-concept-list.nuxt.spec.ts` (2 tests).
- **Deps added**: `cytoscape`, `cytoscape-fcose`; dev dependency `@types/cytoscape`.

### M7 implementation notes (divergences & decisions)

- **Module layout**: UI components in `apps/web/app/components/notes/{folder-tree,note-list,note-detail,markdown-renderer}.vue`; page `apps/web/app/pages/notes/index.vue`; auth middleware `apps/web/app/middleware/auth.ts`; API routes `apps/web/server/api/folders/index.get.ts`, `apps/web/server/api/notes/index.get.ts`, and `apps/web/server/api/notes/[...slug].ts`.
- **Backend helpers**: `server/lib/notes/{paths,tree,tags}.ts` provide workspace-scoped path normalization, folder-tree building, and tag add/remove with AGE mirror. `server/lib/graph/helpers.ts` gained `deleteTaggedEdge` for tag removal.
- **API surface**:
  - `GET /api/folders` → `{ folders: FolderNode[] }` where `FolderNode = { name, path, hasCover, noteCount, children: FolderNode[] }`.
  - `GET /api/notes?folder=` → `{ notes: NoteListItem[] }` where `NoteListItem = { id, path, title, status }`; `folder` query is optional prefix filter.
  - `GET /api/notes/:path` → `NoteDetailNote = { id, path, title, content, status, tags: Tag[], sources: Source[] }`.
  - `PUT /api/notes/:path` → `{ id, path, title, content, status }` (writes to disk and DB, sets `status='pending'`).
  - `POST /api/notes/:path/tags` → `{ id, name, origin }` (origin always `'user'`); `DELETE /api/notes/:path/tags/:tagId` → `204`.
- **Path traversal guard**: `normalizeNotePath` rejects `..`, absolute paths, and non-markdown files; routes return `400` or `404`.
- **Auth & workspace**: all routes use `requireAuth()` + `requireWorkspaceMembership`; returned data is scoped to the workspace.
- **AGE mirror for tag edits**: `addTagToNote` and `removeTagFromNote` run inside a transaction and mirror `Tag` nodes + `TAGGED` edges to AGE. A `runInTransaction` helper makes the functions safe when called inside a test transaction or outside one.
- **Frontend state**: `pages/notes/index.vue` uses `useFetch` for folders, note list, and note detail; detail fetch is conditional on `selectedNotePath` to avoid hitting the list endpoint as a single-note path. Folder click clears the selected note; note selection drives the detail panel.
- **In-app editor**: `note-detail.vue` toggles a plain textarea; `saveNote` PUTs the new content and refreshes the detail + list. The disk file is the source of truth; chokidar sync will update the DB accordingly.
- **Tag UI**: tag list renders with remove buttons; a small input form adds tags. Tags are normalized (lowercase, collapse non-alphanumeric to spaces) and deduplicated per workspace.
- **Markdown rendering**: `markdown-renderer.vue` uses `marked` to render note content to HTML; only safe markdown is expected (no explicit sanitizer added yet).
- **Browser verification**: folder tree, note list filtering, note detail rendering, editing, and tag add/remove all verified in the dev server. Screenshots: `tmp-screenshots/notes-page.png`, `tmp-screenshots/notes-detail.png`.
- **Test result**: 263 tests across 34 files (259 passed, 4 skipped) with `DATABASE_URL` and `NUXT_DATABASE_URL` explicitly set to the aso_notes Docker DB (`postgresql://postgres@127.0.0.1:5433/aso_notes_development`). Component test `note-detail.nuxt.spec.ts` and unit tests `notes-paths.spec.ts`, `notes-tree.spec.ts`, `notes-tags.spec.ts` all green.
- **Deferred**: M6 (Chat UI) remains unimplemented. M9 is not yet defined in this plan.

## Deferred / open

- Doom-loop detection (design from real `messages` data later).
- Concept merge UI (manual dedup stragglers).
- Top-K concept injection when full list bloats prompt (swap at stage level).
- `youtube-transcript` pipeline (prettify stage), TikTok, Excalidraw sources.
- Token streaming for chat answers.
- pg_trgm on concepts if semantic search underperforms in practice.

### M5 implementation notes (divergences & decisions)

- **Module layout**: `server/lib/agent/{types,loop,run-agent,providers,vector}.ts` + `server/lib/agent/tools/{read-note,search-notes,search-concepts,get-concept-neighbors,get-mentions,find-paths-between,search-sources}.ts`; routes live at `server/api/conversations/{index.post,index.get,[id].get}.ts` rather than the plan's `server/api/query.post.ts`.
- **Loop constant**: exported as `MAX_AGENT_ITERATIONS = 10` (the task spec's name), not `MAX_TOOL_ITERATIONS`.
- **SSE event shapes**: each frame is one JSON object prefixed with `data: ` and terminated with a double newline. Events carry a `type` discriminator for easier UI parsing:
  - `tool_call { type: 'tool_call', name, args, toolCallId }`
  - `tool_result { type: 'tool_result', name, result, toolCallId }`
  - `answer { type: 'answer', text, notes[], conversationId }`
  - `error { type: 'error', message }`
  This differs from the plan's sketch (`tool_call {name, args}`, `tool_result {name, summary}`, `answer {text, notes[]}`). The `summary` field was generalized to the full `result` object so the UI can render structured tool output.
- **Tool result contract**: every tool returns `{ result: unknown, notes: string[] }`; `notes` is the list of cited note paths accumulated for the final `answer` event.
- **Tool result shapes** (JSON-serializable):
  - `read_note`: `{ note: { path, title, content } }` or `{ notFound: true, path }` / `{ error }`
  - `search_notes`: `{ notes: [{ path, title, chunks: [{ text, seq }] }], count }`
  - `search_concepts`: `{ concepts: [{ id, name, description, distance }], count }`
  - `get_concept_neighbors`: `{ neighbors: [{ id, name, distance }], count }`
  - `get_mentions`: `{ notes: [{ path, title, chunks: [{ text, seq }] }], count }`
  - `find_paths_between`: `{ paths: [{ nodes: [{ id, name }], edges: [{ type }], length }], count }`
  - `search_sources`: `{ sources: [{ url, title, type, note_path, note_title }], count }`
- **Provider resolution**: `server/lib/agent/providers.ts` exposes `createAgentProviders(env)` which returns OpenRouter providers by default and supports test overrides via `setAgentTestProviders({ llm, embedding })`. The route uses this seam so the feature spec can script a stub LLM.
- **Conversation context**: prior messages of the current conversation are loaded from `messages` and replayed to the LLM in OpenAI-style order. The new user message is persisted before the loop starts; assistant and tool messages are persisted after the loop finishes.
- **AGE path parsing**: `find_paths_between` returns `nodes(p)` and `relationships(p)` from AGE and parses the agtype text manually (stripping `::vertex`/`::edge` type suffixes) because AGE 1.5 rejects list-comprehension syntax (`[x IN list | ...]`) in cypher.
- **GET routes added early**: `GET /api/conversations` (list by updated_at desc) and `GET /api/conversations/:id` (with messages) are implemented now for M6 consumption even though M6 is not yet built.
- **Workspace resolution**: same single-tenant MVP rule as M3 — the route picks the user's first membership by `created_at`.

### M6 implementation notes (divergences & decisions)

- **Module layout**: UI components in `apps/web/app/components/chat/{chat-thread,chat-activity,chat-sidebar}.vue`; page `apps/web/app/pages/chat/index.vue`; composable `apps/web/app/composables/use-chat.ts`; SSE parser `apps/web/app/utils/chat-sse.ts`.
- **Route choice**: `/chat` is the canonical chat page; the signed-in home page (`/`) redirects to `/chat`. A `Chat` nav link was added to the landing header next to Notes/Graph.
- **SSE parser**: `readChatSseEvents(reader)` consumes the POST `/api/conversations` stream using `fetch` + `ReadableStreamDefaultReader`; it reassembles frames split across chunks, tolerates malformed/non-data lines, and yields typed events for `tool_call`, `tool_result`, `answer`, and `error`.
- **Transparency panel**: `chat-activity.vue` renders paired tool-call/tool-result events with the tool name and arguments always visible and the structured result collapsed/expandable.
- **Answer rendering**: `chat-thread.vue` uses the existing `MarkdownRenderer` for assistant answers and renders `answer.notes[]` as links to `/notes?note=<path>`.
- **Notes deep-linking**: `/notes` now reads `?note=` on initial load so citation links land on the correct note.
- **Conversation continuity**: the active `conversationId` is kept after an `answer` event, passed on the next query, reflected in the URL (`/chat?conversationId=...`), and used to load persisted messages when the user selects a sidebar entry.
- **No backend changes**: the M5 conversation routes (`POST`, `GET`, `[id].get`) were consumed as-is; no fixes were needed.
- **Browser verification**: performed with `agent-browser`. Signed-in `/chat` rendered the conversation sidebar, loaded a seeded past conversation, and sent a new query. Because `OPENROUTER_API_KEY` is not configured in `.env.local`, the real LLM call fails and the UI renders the error message gracefully (`NUXT_OPENROUTER_API_KEY is required to create an AI provider`).
- **Test result**: full suite `281 passed | 4 skipped (285)` across 41 files. New specs: `test/unit/chat-sse-parser.spec.ts` (5 tests), `test/components/chat-thread.nuxt.spec.ts` (2 tests), `test/components/chat-activity.nuxt.spec.ts` (1 test), `test/components/chat-sidebar.nuxt.spec.ts` (1 test).
- **Screenshots**: `tmp-screenshots/chat-page-initial.png`, `tmp-screenshots/chat-past-conversation.png`, `tmp-screenshots/chat-error-state.png`, `tmp-screenshots/notes-deep-link.png`.

