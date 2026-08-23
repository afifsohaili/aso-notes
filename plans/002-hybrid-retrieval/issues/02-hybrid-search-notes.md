# 02 — Hybrid search_notes with fused scores

**What to build:** The `search_notes` Tool becomes hybrid: every Query runs a dense leg (existing vector similarity over Chunk embeddings) and a lexical leg (BM25 over Chunk text, Workspace-scoped, backed by a new pg_search index), and a new retrieval module fuses the two ranked lists with Reciprocal Rank Fusion. The fusion lives behind an interface that accepts a fusion strategy, so a weighted-score fusion can replace RRF later without touching the Tool. The Tool's result shape keeps its Note-grouped structure and `limit` semantics (default 5, range 1–20), but each returned Chunk now carries a fused relevance score so the Agent can judge match strength. After this ticket, a Query containing an exact rare term ranks the Note containing that term first even when semantically distant, while synonym Queries keep working via the dense leg.

**Blocked by:** 01 — Add pg_search to the Postgres image.

**Status:** done

- [x] New retrieval module exposes a hybrid search function (dense leg + lexical leg + fusion) and a pure RRF fusion function behind a pluggable-strategy interface
- [x] Migration adds a Workspace-scoped BM25 index over Chunk text with a key field
- [x] `search_notes` returns fused results; Note-grouped payload shape and `limit` argument semantics unchanged
- [x] Each returned Chunk includes its fused relevance score
- [x] Results remain Workspace-scoped
- [x] Test coverage (tool-level transactional, prior art `agent-tools.spec.ts`): exact-term Query ranks the containing Note first despite semantic distance; synonym Query still works; fused ranking beats either leg alone on a mixed fixture set; score present in output; Workspace isolation holds
- [x] Unit coverage for the RRF fuser (prior art `test/unit/chunker.spec.ts`): order stability, ties, disjoint lists, empty lists

## Implementation notes / divergences

- **Index shape:** `CREATE INDEX idx_chunks_bm25 ON chunks USING paradedb (id, workspace_id, text) WITH (key_field = 'id')`. The `key_field` must be a column present in the index column list — pg_search 0.25.x errors with "No key field defined" on INSERT if `id` is not indexed. `id` is the leading column (the key field), `workspace_id` is the Workspace-scoping filter column, `text` is the searchable field.
- **BM25 query mode:** match disjunction (`|||`, OR-of-tokens), not phrase. The query text is passed as a bound parameter (`chunks.text ||| ${query}` via Kysely), never string-interpolated into a SQL literal. Verified empirically that `|||` accepts bound parameters and is injection-safe.
- **Fusion:** RRF with `k = 60`, equal branch weights (1.0 each). The fuser lives behind a `strategy` parameter; only `'rrf'` is implemented, `'weighted'` throws. Ties broken by ascending id for deterministic output.
- **Branch limit:** each leg fetches `BRANCH_LIMIT = 100` candidates before fusion; the tool's `limit` (default 5, range 1–20) is applied after fusion via `.slice(0, limit)`, preserving the existing argument semantics.
- **Divergence — `limit` param dropped from leg helpers:** the per-leg helpers no longer take the tool `limit`; they always fetch the fixed branch limit. This keeps the fused candidate pool independent of the requested result count.
- **Schema dump:** `db/schema.sql` tracks the BM25 index (pg_dump emits `USING paradedb ... WITH (key_field=id)`); regenerated via `pnpm db:schema:dump`.
