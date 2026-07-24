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
- **M3 — Sync**: chokidar plugin, upsert fast path, sweeper, rename guard, folder-cover handling. Chunk+embed stages live; extraction stubbed → notes searchable end-to-end.
- **M4 — Extraction + graph**: extract-graph stage, store-graph with concept resolution + concept embeddings, AGE mirror helpers.
- **M5 — Agent**: tool registry + 7 tools, loop with cap + wrap-up, SSE route, messages persistence.
- **M6 — Chat UI**: conversation sidebar, query box, SSE activity log, answer + citations.
- **M7 — Notes UI**: folder tree, note view, tag management, in-app editor.
- **M8 — Graph UI**: Cytoscape canvas + concept list panel.

## Deferred / open

- Doom-loop detection (design from real `messages` data later).
- Concept merge UI (manual dedup stragglers).
- Top-K concept injection when full list bloats prompt (swap at stage level).
- `youtube-transcript` pipeline (prettify stage), TikTok, Excalidraw sources.
- Token streaming for chat answers.
- pg_trgm on concepts if semantic search underperforms in practice.
