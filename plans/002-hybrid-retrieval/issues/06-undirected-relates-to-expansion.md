# 06 — Traverse RELATES_TO undirected in Graph Expansion

**What to build:** Graph Expansion in `search_notes` currently follows only outgoing `RELATES_TO` edges `(a)-[r]->(b)`, but Relations are stored as one directed edge per ordered pair and the existing `get_concept_neighbors` Tool treats them as undirected. A Relation stored Y→X is invisible when expanding from X, silently dropping half the graph. After this ticket, expansion traverses `RELATES_TO` undirected (same semantics as `get_concept_neighbors`), so a Query matching Note A surfaces Note B regardless of which direction the Relation was stored.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Expansion Cypher matches `RELATES_TO` without a direction constraint (matching `conceptNeighbors` semantics)
- [x] Self-edges still excluded; workspace scoping unchanged
- [x] Test coverage: a Relation stored only as Y→X still expands from X to Y (reverse-edge case); existing expansion tests keep passing
- [x] Provenance still reports the Relation type correctly for reverse-direction hits

## Implementation notes / divergences

- **Cypher change:** `expansion.ts` now uses `MATCH (a:Concept)-[r:RELATES_TO]-(b:Concept)` (undirected), matching `conceptNeighbors()` in `graph/helpers.ts`. Only the `->` arrow became `-`; the `WHERE` clause (`b.workspace_id = <ws> AND b.id <> a.id`) is untouched, so self-edge exclusion and workspace scoping are preserved.
- **Test added:** a reverse-direction case in `search-notes-graph-expansion.spec.ts` — Relation stored only as Y→X (from Concept Y to Concept X), query matching Note A (Concept X) still surfaces Note B (Concept Y) with `relationType: 'contradicts'` and correct matched/neighbor provenance. This test failed (empty `related`) against the directional Cypher and passes now.
- **Divergence:** none. All 8 pre-existing expansion tests still pass unchanged; none encoded directionality incorrectly.
- **Full suite:** `pnpm --filter web vitest run test/e2e/search-notes-graph-expansion.spec.ts` green (9 tests); full `pnpm test:e2e` green (384 tests); `pnpm typecheck` clean; lint clean. One unrelated `folder-sync.spec.ts` failure was observed under full-suite load but passed in isolation and on re-run (Redis ingestion timing flake, not graph-related).
