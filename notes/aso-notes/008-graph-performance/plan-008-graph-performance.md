# Plan 008 — Graph Page Performance (Ego-Graph + WebGL Renderer)

Status: decisions locked via option review (2026-08-03). In progress.
Glossary: see `../CONTEXT.md`.

## Problem

The `/graph` page renders the **entire workspace graph** in one shot: ~1,100 nodes (762 Concepts, 90 Notes, 188 Tags, 73 Topics) and ~4–5k edges in dev. Symptoms:

- `/api/graph` (`getFullGraph` in `server/lib/graph/ui.ts`) ships an unbounded full-graph payload via 9 sequential Cypher queries.
- Cytoscape fcose layout runs synchronously on the full graph at init (main-thread block) and re-runs from scratch on any data change (`watch` with `deep: true` rebuilds all elements).
- Canvas renderer draws every node label always; no viewport optimizations; `bezier` edges. Cytoscape 2D canvas degrades past ~2k elements.
- Sidebar renders all concepts as DOM rows (accepted for now — not virtualizing).

## Locked decisions

1. **Ego-graph drill-down.** Default view is a trimmed overview; clicking a Topic/Concept fetches and expands its neighborhood in place. No full-graph dump.
2. **Initial canvas: Topics + top concepts.** All Topic nodes + top 10 Concepts per Topic by mention count, plus edges among included nodes.
3. **WebGL renderer behind a swappable seam.** A `GraphRenderer` interface with two implementations: existing Cytoscape (fallback) and sigma.js (graphology ecosystem). Renderer chosen via runtime config flag.
4. **Sidebar unchanged** — no virtualization in this plan.
5. **Depth = 1, expand-per-click.** Neighborhood fetches use depth 1; deeper exploration is repeated clicks, not deeper queries.

## Architecture

### Renderer seam — `app/lib/graph-renderer/` (new)

```ts
interface GraphRenderer {
  mount(container: HTMLElement): Promise<void>
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void
  highlight(nodeId: string | null): void
  onNodeClick(cb: (node: GraphNode) => void): void
  destroy(): void
}
```

- `types.ts` — interface + shared types
- `cytoscape-renderer.ts` — existing `graph-canvas.vue` logic moved behind the interface
- `sigma-renderer.ts` — sigma.js + graphology (WebGL)
- `index.ts` — factory `createGraphRenderer(impl)`; selection via runtime config (e.g. `public.graphRenderer`, default `sigma` with `cytoscape` fallback)

### Ego-graph API

- `GET /api/graph` — reworked: topic overview (Topics + top-10 Concepts/topic + edges among included nodes). No Notes/Tags in default view.
- `GET /api/graph/neighborhood?node=<id>&depth=1` — new: ego-graph nodes/edges around a node, workspace-scoped, depth clamped to [1, 2].
- `server/lib/graph/ui.ts` — add `getTopicOverview(db, workspaceId)`, `getEgoGraph(db, workspaceId, nodeId, depth)`. Keep `getFullGraph` only if still referenced; otherwise remove.

### Page wiring

- `components/graph/graph-canvas.vue` — thin wrapper: container div + legend, delegates everything to the renderer from the seam.
- `pages/graph/index.vue` — drill-down state: set of expanded node ids, incremental neighborhood fetch on node click, merge new nodes/edges into renderer; Note nodes still navigate to `/notes<path>`.

## Phases

| Phase | Scope | Commit |
| ----- | ----- | ------ |
| 1 | Server: `getTopicOverview`, `getEgoGraph`, `/api/graph` rework, `/api/graph/neighborhood` endpoint. TDD feature specs (endpoint input → response body + DB correctness) + unit edge cases (unknown node, depth clamp, workspace isolation, empty graph). | one commit |
| 2 | Renderer seam: `GraphRenderer` interface, move existing Cytoscape code into `cytoscape-renderer.ts`, factory, `graph-canvas.vue` uses seam. Existing component specs must stay green. | one commit |
| 3 | sigma.js renderer: `sigma-renderer.ts` implementing the interface (nodes/edges/labels, highlight, click). Deps: `sigma`, `graphology`. | one commit |
| 4 | Page drill-down wiring: expanded-set state, neighborhood fetch + merge, renderer flag via runtime config. | one commit |

## Phase status log

_(subagents update this section as phases complete; record divergences from plan)_

- Phase 1: done — `getTopicOverview` + `getEgoGraph` in `server/lib/graph/ui.ts`, `GET /api/graph` reworked to the overview, new `GET /api/graph/neighborhood?node&depth`. `getFullGraph` removed (no remaining references after the rework — frontend consumes the API, doesn't import the lib). 19 new/updated e2e specs; full suite 700 tests green.

  **Divergences / decisions:**
  - **Query strategy — overview:** 5 workspace-scoped queries: (1) all Topic vertices, (2) one relational join over `concept_topics ⋈ mentions` for per-(concept, topic) mention counts (`COUNT(DISTINCT mentions.id)` so the topic fan-out can't inflate counts), (3) Concept names from AGE via one `IN [...]` query, (4)+(5) GROUPED_UNDER + RELATES_TO edges fetched workspace-wide and filtered to included nodes in JS.
  - **Query strategy — ego graph:** a single *untyped* variable-length traversal `(start {id})-[*1..depth]-(n)` with `UNWIND relationships(p)` + `label(rel)`. Mixed edge-type paths count as hops (Concept -MENTIONS-> Note -TAGGED-> Tag is 2 hops). Two AGE features were probed and rejected: relationship-type alternation `[r:A|B]` (syntax error) and the `all(... IN relationships(p))` predicate (syntax error); edge `workspace_id` is filtered in JS as the scope backstop, and vertices are scope-filtered in Cypher.
  - **Ego payload includes the center node** (self-contained ego graph, so the page's merge logic needs no special-casing). Unknown or out-of-workspace node → `{ nodes: [], edges: [] }`; a known isolated node → `{ nodes: [center], edges: [] }`.
  - **Ego edge set** = edges lying on paths of length ≤ depth from the center (depth 1 returns only edges incident to the center; an edge between two depth-1 neighbors shows up at depth 2).
  - **Helper factoring:** `resolveWorkspaceId` extracted to `server/utils/workspace.ts`; only `index.get.ts` and `neighborhood.get.ts` were rewired to it (the ~13 other inlined copies are untouched — out of scope).
  - **Data quirk surfaced:** `mentions` has a unique `(chunk_id, concept_id)` constraint, so seeded mention counts need one chunk per mention.
  - **Depth parsing:** `parseInt`, missing/garbage → default 1, clamped to [1, 2].
- Phase 2: done — renderer seam extracted: `app/lib/graph-renderer/{types,cytoscape-renderer,index}.ts`; the existing Cytoscape logic moved out of `graph-canvas.vue` behind `GraphRenderer` (mount/setGraph/highlight/onNodeClick/destroy); factory `createGraphRenderer(impl)` (only `'cytoscape'` registered, throws on unknown); `graph-canvas.vue` is now a thin wrapper (container + legend, delegates to the seam, props/emits unchanged so the page needed no edits). `setGraph` is a full replace; merges are page-level (Phase 4). Existing `graph-canvas.nuxt.spec.ts` untouched and green; 10 new unit specs in `test/unit/graph-renderer.spec.ts` (factory + contract via mocked cytoscape). Lint clean; typecheck has zero errors in touched files.

  **Divergences / decisions:**
  - **The phase brief's parentheticals didn't match the actual component:** `graph-canvas.vue` had no `.muted`-class stylesheet, no `label-hide` zoom listener, and no `layoutPromise` — its highlight dims via `removeStyle()` + an `opacity: 0.2` bypass on the complement of the selected neighborhood, and it re-runs fcose on data change. "No behavior change" won: the renderer preserves the actual logic exactly. `.muted`-class highlight and zoom-threshold label hiding stay for Phase 3 (sigma).
  - **`mount()` has no data to lay out.** The interface delivers data via `setGraph()` after `mount()`, so mount creates an empty graph; the constructor's auto-run `layout:` config was moved into an explicit `runLayout()` shared by mount and setGraph. `mount()` resolves once the (empty) fcose layout settles (`layout.promiseOn('layoutstop')`), so callers know the renderer is ready.
  - **fcose config unified.** Today's data-change watch re-layout omitted `componentSpacing`/`nodeRepulsion`/`idealEdgeLength` (init only). `setGraph` now always runs the full config, so the initial paint matches today's and updates get the intended tuning params.
  - **Renderer types mirror the API exactly** (`id/label/name/ref`; `source/target/type/edgeType`) — no `meta` on nodes, no `id`/`label` on edges, since neither the API nor the component carries them.
  - **New ambient declaration** `app/lib/graph-renderer/cytoscape-fcose.d.ts` — `cytoscape-fcose` ships no types; the old component had the same TS7016 inline.
  - `graph-canvas.vue` now types its props from the seam (`~/lib/graph-renderer/types`) instead of `~/server/lib/graph/ui`; structurally identical, so `pages/graph/index.vue` is untouched.
  - No runtime-config wiring yet (deferred to Phase 4 by scope); the component hardcodes `'cytoscape'`. `GRAPH_RENDERER_IMPLS` registry exported for Phase 4.
- Phase 3: pending
- Phase 4: pending
