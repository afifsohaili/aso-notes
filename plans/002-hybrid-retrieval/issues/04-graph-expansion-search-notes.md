# 04 — Graph Expansion in search_notes

**What to build:** The `search_notes` Tool gains automatic Graph Expansion. After hybrid ranking, it collects the Concepts mentioned (via Mentions) in the top fused Chunks, traverses one hop of Relations in the AGE graph from those Concepts, and fetches up to `relatedLimit` Mentions of the neighboring Concepts from Notes not already in the result set. These are returned as a separate `related` section in the Tool payload, each entry labeled with its provenance chain (matched Chunk → Concept A → Relation → Concept B → related Chunk) so the Agent can explain why the material was included. A new optional Tool argument `relatedLimit` (default 3, max 10) bounds token growth. The dedicated graph Tools (`get_concept_neighbors`, `find_paths_between`) stay unchanged. After this ticket, a Query matching Note A also surfaces Note B's Chunk when Note A mentions Concept X, X relates to Concept Y, and Note B mentions Y — without the Agent calling any graph Tool.

**Blocked by:** 02 — Hybrid search_notes with fused scores (expansion builds on the fused top results).

**Status:** done

- [x] `search_notes` payload gains a `related` section, clearly separated from direct hits
- [x] Each related entry carries its provenance chain (Concept names and the Relation between them)
- [x] New optional `relatedLimit` argument: default 3, maximum 10; expanded Chunks never duplicate direct hits or Notes already in the result
- [x] Expansion is one hop only; dense Concept hubs cannot blow up the result beyond the cap
- [x] No expansion happens (empty `related`) when matched Concepts have no Relations
- [x] Results remain Workspace-scoped
- [x] Test coverage (tool-level transactional, prior art `graph-remirror.spec.ts` for AGE in tests): Note A → Concept X → Relation → Concept Y → Note B fixture surfaces Note B in `related` with correct provenance; no Relations → empty `related`; cap respected; no duplication of direct hits

## Implementation notes / divergences

- Expansion lives in a new helper `expandRelatedChunks` at `apps/web/server/lib/retrieval/expansion.ts` (exported from `retrieval/index.ts`). The Tool orchestrates; only the graph traversal touches AGE. This keeps `retrieval` the module owning the search/expansion concern rather than inlining Cypher in the Tool.
- Provenance shape per related entry: `{ path, title, text, seq, provenance: { matchedConcept, neighborConcept, relationType } }`. `matchedConcept` is the direct-hit Concept name, `neighborConcept` the one-hop neighbor, `relationType` the `RELATES_TO` edge type.
- `related` is always present as an array when `relatedLimit > 0` (empty `[]` when no Relations / no matched Concepts). `relatedLimit: 0` (or `relatedLimit` omitted with a falsy value) omits `related` entirely — a tool call with expansion disabled is payload-identical to the pre-Phase-4 shape. Omitted `relatedLimit` defaults to 3.
- Deduplication: direct-hit Chunks are excluded by passing the direct result's Note ids as `excludedNoteIds`; within `related`, Chunks are deduped by chunk id, first provenance wins.
- Graph traversal query uses AGE list syntax `a.id IN [..]` (a single-element Cypher `IN (...)` list is a syntax error in AGE).
- One-hop, direction `(a:Concept)-[r:RELATES_TO]->(b:Concept)`; neighbors are workspace-scoped by `b.workspace_id` and self-edges excluded via `b.id <> a.id`. `get_concept_neighbors` and `find_paths_between` are untouched.
- Test dependency: `search_notes` now reads the AGE graph on every invocation, so the agent-loop tests in `agent-conversations.spec.ts` provision the AGE catalog via `ensureNotesGraphCatalog` (added to `seedNotesDomain`). Previously those tests never touched AGE.
- No schema changes; no type regeneration or schema dump needed.
