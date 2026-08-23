# 03 — Hybrid search_concepts

**What to build:** The `search_concepts` Tool becomes hybrid, reusing the retrieval module built in ticket 02: a lexical leg (BM25 over Concept name + description, Workspace-scoped, backed by a new pg_search index) fused with the existing vector leg. The Tool output keeps its shape but exposes the fused score instead of raw vector distance. After this ticket, a Query naming a Concept exactly ranks that Concept first, while semantic matches keep working.

**Blocked by:** 02 — Hybrid search_notes with fused scores (provides the retrieval module and fuser).

**Status:** done

- [x] Migration adds a Workspace-scoped BM25 index over Concept name + description
- [x] `search_concepts` returns hybrid-fused results with a fused score per Concept
- [x] Existing argument semantics (`limit`) and result shape otherwise unchanged
- [x] Test coverage (tool-level transactional): exact-name Concept ranks first; semantic match still works; Workspace isolation holds

## Implementation notes / divergences

- **Index shape:** `CREATE INDEX idx_concepts_bm25 ON concepts USING paradedb (id, workspace_id, name, description) WITH (key_field = 'id')`. Mirrors the chunks index from ticket 02: `key_field` must be a column in the index (pg_search 0.25.x), `id` is the leading column, `workspace_id` is the Workspace-scoping filter column, `name` and `description` are the searchable fields.
- **BM25 query mode:** match disjunction (`|||`) over name OR description, both passed as bound parameters (never string-interpolated). **Divergence from a naive OR:** the two disjuncts must be wrapped in parentheses — `(concepts.name ||| $query OR concepts.description ||| $query)`. Without parens the workspace filter was bypassed and results leaked across workspaces (verified by a probe query before fixing).
- **Reuse of the retrieval module:** added `hybridSearchConcepts` to `server/lib/retrieval/hybrid.ts`, alongside the Phase-2 `hybridSearchChunks`. Both legs share `BRANCH_LIMIT = 100`, the same RRF fuser (`k = 60`, equal weights, ties by ascending id), and the same `.slice(0, limit)` applied after fusion. The module stays deep; the Tool only calls the helper and reshapes the payload.
- **Output shape:** each Concept now exposes the fused `score` instead of the raw vector `distance`. The `distance` field is gone from the Tool output. The only caller relying on `distance` was `test/e2e/agent-tools.spec.ts` (`concepts[0].distance < concepts[1].distance`), updated to compare `score` descending. `store-graph.ts` and `consolidation/shortlist.ts` still compute raw `distance` for their own non-retrieval purposes and are untouched.
- **Schema dump:** `db/schema.sql` tracks the BM25 index (`USING paradedb ... WITH (key_field=id)`); regenerated via `pnpm db:schema:dump`. Non-deterministic noise (`\restrict` token, notifications timestamp defaults) was reverted, keeping only the index diff (same as ticket 02).
