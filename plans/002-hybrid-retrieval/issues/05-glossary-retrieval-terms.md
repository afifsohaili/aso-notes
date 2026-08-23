# 05 — Glossary update for retrieval terminology

**What to build:** The domain glossary (`CONTEXT.md`) gains the new retrieval terms introduced by this feature — Hybrid Retrieval, dense leg, lexical leg, Fusion, Graph Expansion — each with a definition and an avoid-list, under the Agentic RAG section. After this ticket, future specs and tickets use the same vocabulary for the hybrid retrieval behavior.

**Blocked by:** 03 — Hybrid search_concepts; 04 — Graph Expansion in search_notes (terms describe behavior as built).

**Status:** done

- [x] `CONTEXT.md` defines: Hybrid Retrieval, dense leg, lexical leg, Fusion, Graph Expansion
- [x] Each term has an avoid-list of near-synonyms
- [x] Terms are consistent with how the built Tools behave (scores, `related` section, `relatedLimit`)

## Implementation notes / divergences

- none — matches ticket.
