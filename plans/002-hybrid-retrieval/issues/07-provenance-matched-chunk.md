# 07 — Include the matched Chunk in Graph Expansion provenance

**What to build:** Spec decision 5 defines the provenance chain as "matched Chunk → Concept A → Relation → Concept B → related Chunk", but the built provenance carries only `{ matchedConcept, neighborConcept, relationType }` — the Agent cannot tell which direct-hit Chunk led to a related Chunk. After this ticket, each `related` entry's provenance also identifies the matched Chunk (its Note path and chunk seq), so the Agent can trace and explain the full chain.

**Blocked by:** None — can start immediately (independent of 06; if both land, merge normally).

**Status:** done

- [x] Each `related` entry's provenance includes the matched Chunk's Note path and seq
- [x] Existing provenance fields (matchedConcept, neighborConcept, relationType) unchanged
- [x] First-provenance-wins dedupe behavior unchanged
- [x] Test coverage: provenance identifies the correct source Chunk when multiple direct hits mention the same Concept

## Implementation notes / divergences

- **Provenance shape:** each `related` entry's `provenance` now carries `matchedChunk: { path, seq }` alongside the unchanged `{ matchedConcept, neighborConcept, relationType }`. `RelatedChunk` in `retrieval/expansion.ts` and the Tool payload type were updated accordingly.
- **SQL join-back:** step 1b in `expansion.ts` joins `mentions → chunks → notes` filtered to `chunk_id IN resultChunkIds AND concept_id IN matchedIds`, ordered by `(notes.path, chunks.seq)`, and keeps the first row per Concept into a `concept_id → { path, seq }` map. The per-neighbor loop then looks up the matched Chunk by the Cypher row's `matched_id`. This is the simplest correct shape — one extra relational query, no Cypher change.
- **Determinism:** when several direct-hit Chunks mention the same matched Concept, the first by `(path, seq)` wins, matching the direct-hit grouping order. First-provenance-wins dedupe (the `seenChunk` set) is untouched.
- **Test added:** a multi-source case in `search-notes-graph-expansion.spec.ts` — two direct-hit Notes (A and C) both mention Concept X, Note B mentions Concept Y; asserts the related entry's `matchedChunk` is Note A's chunk (first by path/seq), not Note C's. The two existing provenance assertions (basic + reverse-direction) were extended to include `matchedChunk`.
- **Divergence:** none. All 8 pre-existing expansion tests pass; only the two provenance assertions legitimately grew.
- **Full suite:** `pnpm --filter web vitest run test/e2e/search-notes-graph-expansion.spec.ts` green (10 tests); full `pnpm test:e2e` green (385 tests); `pnpm typecheck` clean; lint clean.
