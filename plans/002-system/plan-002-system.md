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
| `chunks` | id, workspace_id, note_id FK, seq, text, token_count, embedding vector(N), timestamps | Wipe+rewrite per ingestion. HNSW index on embedding. |
| `concepts` | id, workspace_id, name, name_normalized (unique per workspace), description, embedding vector(N), timestamps | name_normalized = lowercase, collapse whitespace/punct. HNSW on embedding. |
| `relations` | id, workspace_id, from_concept_id FK, to_concept_id FK, type, description, timestamps | type = free-text label from LLM. |
| `mentions` | id, workspace_id, chunk_id FK, concept_id FK, unique(chunk_id, concept_id) | Chunk-level. Cascade delete via chunks. |
| `tags` | id, workspace_id, name, name_normalized (unique per workspace), timestamps | |
| `note_tags` | note_id FK, tag_id FK, origin (`user`\|`ai`), unique(note_id, tag_id) | Re-ingestion replaces only origin='ai', respecting dismissals. |
| `note_tag_dismissals` | note_id FK, tag_id FK, created_at | Written when user removes an AI tag; blocks re-adding. |
| `links` | id, workspace_id, from_note_id FK, to_note_id FK (nullable), raw_target, timestamps | Dangling links keep raw_target; re-resolved when target note appears. |
| `sources` | id, workspace_id, note_id FK, url, url_normalized, title, type, timestamps | type derived from host (youtube/tiktok/web). Dedup key (note_id, url_normalized). |
| `conversations` | id, workspace_id, title, timestamps | Title from first ~60 chars of first query. |
| `messages` | id, conversation_id FK, role (`user`\|`assistant`\|`tool`), content, tool_calls jsonb, tool_call_id, created_at | OpenAI-style; full replay of agent runs. |

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

- **M1 — Schema**: migrations for all tables + AGE graph creation + indexes (vector HNSW, name_normalized uniques, pg_trgm not needed). Regenerate types + schema dump.
- **M2 — Pipeline framework + AI strategy**: Stage/Registry/Context, boot validation, OpenRouter chat+embed clients behind interfaces, BullMQ ingestion queue registration.
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
