# Hybrid Retrieval & Graph Expansion — Spec

**Status:** ready-for-agent

## Problem Statement

When the User asks a Query, the Agent retrieves Context with Tools that run raw cosine top-k vector search only. This causes three concrete failures:

1. **Exact terms miss.** A Query containing a rare name, an exact Concept title, an error code, or an unusual word can fail to surface the Note that contains it, because dense embeddings match on meaning, not tokens.
2. **Weak matches enter the Context.** There is no relevance floor and no score shown to the Agent, so near-random Chunks can be presented as relevant.
3. **Related Notes stay hidden.** Notes connected only through the graph (Note A mentions Concept X, Concept X relates to Concept Y, Note B mentions Concept Y) are only found if the Agent decides to call graph Tools. The Agent often does not.

## Solution

Retrieval becomes **Hybrid Retrieval**: every similarity search runs a dense (vector) leg and a lexical (BM25 full-text) leg and fuses the two ranked lists with Reciprocal Rank Fusion (RRF). Fused results carry a score the Agent can read.

In addition, `search_notes` performs **Graph Expansion**: after hybrid ranking, it follows one hop of Relations from the Concepts mentioned in the top Chunks and returns a small, clearly labeled set of related Chunks from other Notes — automatically, without the Agent needing to call graph Tools.

## User Stories

1. As a User, I want exact names and rare terms in my Query to match Notes that contain them, so that I can find what I wrote even when I phrase the Query loosely.
2. As a User, I want a Query for a Concept by its exact name to rank that Concept first, so that I can navigate my vocabulary precisely.
3. As a User, I want synonym-based Queries to keep working, so that natural language questions still find semantically related Notes.
4. As a User, I want mixed Queries (part exact term, part semantic) to find the right Note, so that I do not have to choose a search style.
5. As a User, I want the Agent to see a relevance score for each retrieved Chunk, so that it can ignore weak matches in its Answer.
6. As a User, I want Notes related through my Concept graph to appear as Context even when they do not match the Query directly, so that serendipitous connections surface.
7. As a User, I want related Chunks labeled with the Concept chain that connects them to my Query, so that I can judge why they were included.
8. As a User, I want the amount of graph-expanded Context to be bounded, so that Answers stay fast and do not drown in tangential material.
9. As a User, I want retrieval to stay scoped to my Workspace, so that I never see another Workspace's Notes, Concepts, or Chunks.
10. As a User, I want the existing Agent Tools and Conversation flow to keep working unchanged, so that the chat experience is stable.
11. As the Agent, I want `search_notes` to return a fused ranking from both legs, so that I receive the best candidates from each.
12. As the Agent, I want `search_concepts` to match Concept names lexically, so that exact-name lookups succeed.
13. As the Agent, I want a separate `related` section in `search_notes` results, so that I can distinguish direct hits from graph-expanded Context.
14. As the Agent, I want provenance (which Concepts connect a related Chunk to the Query), so that I can explain citations in my Answer.
15. As a developer, I want the fusion strategy isolated behind a small interface, so that a weighted-score fusion can replace RRF later without touching the Tools.
16. As a developer, I want the BM25 index maintained automatically by Postgres, so that Ingestion code does not change.
17. As a developer, I want the database image to carry the search extension in a pinned, reproducible way, so that dev, test, and prod behave identically.
18. As a developer, I want domain terminology for the new retrieval concepts recorded in the glossary, so that future specs use consistent language.

## Implementation Decisions

Decisions locked with the user during planning:

1. **Lexical engine: ParadeDB `pg_search` (true BM25), not `tsvector`.** The project owns its Postgres Docker image (Postgres 16, already compiles pgvector and Apache AGE from pinned sources). `pg_search` is added to that image as a pinned prebuilt package for PG16 — no Rust toolchain in the image. A migration creates the extension. Recreating the dev database volume is acceptable; the project is in heavy development and a full Rebuild of derived data is fine.
2. **Fusion: RRF now, pluggable later.** A new server-side retrieval module owns ranking fusion. Its fusion function implements Reciprocal Rank Fusion (rank-position based, robust to incompatible score scales, no tuning). The interface accepts a fusion strategy so a weighted-score-sum fusion can be introduced later as a config switch without changing callers.
3. **Scope: both similarity Tools go hybrid.**
   - `search_notes`: BM25 over Chunk text, Workspace-scoped; fused with the existing vector leg over Chunk embeddings. Existing argument semantics (`limit`, default 5, range 1–20) and Note-grouped result shape are preserved.
   - `search_concepts`: BM25 over Concept name + description, Workspace-scoped; fused with the existing vector leg. Concept names are short exact strings where lexical match is strongest.
4. **Scores flow to the Agent.** `search_notes` stops dropping the relevance signal: fused results include a score per Chunk so the Agent can judge relevance. (`search_concepts` already exposes distance; it exposes the fused score instead.)
5. **Graph fusion shape: Auto-traverse expansion** (chosen over graph-proximity score boosting). `search_notes` gains Graph Expansion:
   - Collect the Concepts mentioned (via Mentions) in the top fused Chunks.
   - Traverse one hop of Relations in the AGE graph from those Concepts.
   - Fetch up to `relatedLimit` Mentions of the neighboring Concepts **from Notes not already in the result set**.
   - Return these as a separate `related` section, each entry labeled with its provenance chain (matched Chunk → Concept A → Relation → Concept B → related Chunk).
   - New optional Tool argument `relatedLimit` (default 3, max 10) bounds token growth. Expansion is automatic but bounded.
   - The dedicated graph Tools (`get_concept_neighbors`, `find_paths_between`) remain unchanged; the Agent can still traverse deliberately.
6. **Schema changes are index-only.** BM25 indexes on Chunks (Workspace id + text, with a key field) and on Concepts (Workspace id + name + description). No table shape changes; no backfill; Ingestion code untouched since the indexes are maintained by Postgres. Generated types and the schema dump are regenerated as usual.
7. **No relevance floor yet.** A hard similarity threshold was discussed as a cheap win but is deferred; exposing scores (decision 4) is the first step and keeps this spec focused.
8. **Glossary update is part of the work.** New terms — Hybrid Retrieval, dense leg, lexical leg, Fusion, Graph Expansion — are added to `CONTEXT.md` per repo policy on domain language changes.
9. **Version pinning risk is accepted knowingly.** The `pg_search` query API has moved across versions; the implementation pins one version and verifies operator/scoring syntax at implementation time against that version's docs.

## Testing Decisions

**What makes a good test here:** tests assert external behavior of the Tool (ranked output given fixture data), not SQL strings, index internals, or fusion math internals.

Two seams, both existing:

1. **Tool-level transactional integration tests** — primary seam. Prior art: `test/e2e/agent-tools.spec.ts`, `test/e2e/graph-remirror.spec.ts` (AGE in transactional tests). Uses `test` from `@base/testing/test` and `fixtures.load()`; template DB runs all migrations, so extension and indexes exist or every test fails — no separate infra test needed.
   - `search_notes`: an exact-term Query ranks the Note containing that term first even when semantically distant; a synonym Query still works via the dense leg; on a mixed fixture set the fused result beats either leg alone; Workspace isolation holds; result shape and `limit` semantics unchanged; fused score present in output.
   - `search_concepts`: exact-name Concept ranks first; semantic match still works.
   - Graph Expansion: fixture with Note A → Concept X → Relation → Concept Y → Note B; a Query matching Note A surfaces Note B's Chunk in the `related` section with the correct provenance chain; no expansion when Concepts have no Relations; `relatedLimit` cap respected; expanded Chunks never duplicate direct hits.
2. **Pure fuser unit tests** — secondary seam. Prior art: `test/unit/chunker.spec.ts`. RRF order stability, tie handling, disjoint input lists, empty lists.

## Out of Scope

- Any reranker (cross-encoder API, local model, LLM listwise) — explicitly deferred by the user.
- MMR / diversity dedup, cross-Tool dedup, per-Note caps.
- Query transformation (multi-query expansion, HyDE).
- Recency or metadata (Folder, Tag, date) boosting and filtering.
- Embedding model or chunking strategy upgrades; no re-embedding.
- Graph-proximity as a ranking score (boosting) — expansion was chosen instead.
- Changes to `get_mentions`, `read_note`, `search_sources`, or any frontend/UI surface.
- Weighted-score-sum fusion — the interface allows it; it is not built.

## Further Notes

- Suggested build order (each step independently shippable and testable):
  1. Image + extension migration.
  2. Retrieval module with RRF fuser.
  3. Hybrid `search_notes` (+ scores).
  4. Hybrid `search_concepts`.
  5. Graph Expansion in `search_notes`.
  6. `CONTEXT.md` glossary update.
- Risk: BM25 index write amplification on Chunk rewrites — negligible at personal-notes scale.
- Risk: Cypher fan-out on dense Concept hubs during expansion — bounded by `relatedLimit` and one-hop traversal.
