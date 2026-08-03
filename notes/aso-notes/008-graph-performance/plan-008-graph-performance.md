# Plan 008 — Graph Page Performance (Ego-Graph + WebGL Renderer)

Status: complete — all four phases shipped (ego-graph API, renderer seam, sigma WebGL renderer, drill-down + renderer flag). 2026-08-03.
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
- Phase 3: done — `app/lib/graph-renderer/sigma-renderer.ts` implements `GraphRenderer` with sigma.js v3 (WebGL) + graphology. `'sigma'` registered in `GRAPH_RENDERER_IMPLS` and the factory (default selection still `'cytoscape'`; runtime-config wiring stays Phase 4). Deps pinned: `sigma@^3.0.3`, `graphology@^0.26.0`, `graphology-layout@^0.6.1`, `graphology-layout-forceatlas2@^0.10.1`. 12 new unit specs in `test/unit/graph-renderer-sigma.spec.ts` (sigma + layout libs mocked at the boundary, assertions run against the real graphology graph); Phase 2's factory spec updated (its "throws on unknown" test used `'sigma'` as the unknown impl — now `'paperjs'`). Full unit project 387 tests green; `graph-canvas.nuxt.spec.ts` green (proves the factory import path is SSR-safe); lint clean; typecheck has zero new errors in touched files (49 pre-existing elsewhere, unchanged from baseline).

  **Divergences / decisions:**
  - **Colors.** The phase brief specified Note `#2563eb` / Concept `#16a34a` / Topic `#9333ea`, but those do not match the legend actually shipped in `graph-canvas.vue` (Topic `#7c3aed`, Concept `#4f46e5`, Note `#059669`, Tag `#d97706` — only Tag agreed). User confirmed on the spot: sigma uses the **actual legend colors** so the graph matches the legend. Brief's hexes recorded here as a spec/data mismatch.
  - **sigma v3 removed the reducer API.** The brief asked for dimming via node/edge reducers (`setNodeReducer`/`removeEdgeReducer`); those exist in sigma v2 only and are gone in v3 (the version `pnpm add sigma` installed). Highlight is implemented the v3 way: mutate node/edge `color` attributes on the graphology graph (base colors kept in a `baseColor` attribute, dimmed to `rgba(…, 0.2)`) and call `sigma.refresh()`.
  - **sigma cannot be statically imported — SSR hazard is real, not hypothetical.** sigma 3.0.3's module-level code references `WebGL2RenderingContext`, which throws `ReferenceError` in Node/SSR. `sigma-renderer.ts` therefore dynamic-imports sigma inside `mount()` (same pattern as cytoscape's dynamic import); graphology + both layout libs are pure JS and safe as static imports. Verified: `graph-canvas.nuxt.spec.ts` (which imports the factory → sigma renderer in a Nuxt env) stays green.
  - **Highlight semantics.** Kept 1-hop: the highlighted node *and* its direct neighbors stay full-opacity (matches cytoscape's `neighborhood().add(selected)`), edges stay full only when incident to the highlighted node. (The brief left this as "your choice… be consistent"; consistent with cy.)
  - **Layout.** sigma ships no layout; `setGraph` seeds with `graphology-layout` `circular.assign` then runs `graphology-layout-forceatlas2` `assign` synchronously for 150 iterations (`inferSettings` for the graph) — no webworker variant. Cost is fine for the ~hundreds-of-nodes overview. `sigma.refresh()` after assign.
  - **Labels.** `labelRenderedSizeThreshold: 8` (sigma default 6) — labels render only when the node is large enough on screen, an intentional improvement over cytoscape's always-on labels.
  - **Sizes/edges.** Node px sizes Topic 12 / Concept 8 / Note 6 / Tag 5. Edges `#94a3b8` at size 1.5 with `type` kept in attributes (undirected graphology graph — edges are bidirectional for layout).
  - **mount() resolves after instance creation + initial `refresh()`** of the empty graph (sigma runs its render loop via rAF internally; cytoscape instead awaited its fcose `layoutstop`). Defensive edge skip: an edge whose endpoints aren't in the node list is dropped rather than crashing graphology's `addEdge`.
- Phase 4: done — page drill-down + renderer flag. `runtimeConfig.public.graphRenderer` (default `NUXT_PUBLIC_GRAPH_RENDERER || 'sigma'`); `graph-canvas.vue` reads it once at setup via `resolveGraphRenderer()` (`app/lib/graph-renderer/config.ts` — only `'sigma' | 'cytoscape'` valid, anything else falls back to `'sigma'`). `pages/graph/index.vue` keeps the `/api/graph` overview as the initial load, then expands Topic/Concept clicks in place: 1-hop `/api/graph/neighborhood` fetch merged via pure `mergeGraphNodes`/`mergeGraphEdges` helpers (`app/lib/graph-renderer/merge.ts`); expanded ids tracked in a `ref<Set>`, in-flight fetches guarded by a plain Set; failed fetches show a dismissible `role="alert"` note and are NOT marked expanded (retry on next click). Note clicks still navigate to `/notes<path>`. New specs: `graph-renderer-config.spec.ts` (5), `graph-merge.spec.ts` (6), `graph-page.nuxt.spec.ts` (7, page-level drill-down), `graph-canvas-config.nuxt.spec.ts` (renderer selection). Full nuxt+unit project 483 tests green; graph e2e 19 green; lint clean; typecheck zero errors in touched files (49 pre-existing elsewhere, unchanged).

  **Divergences / decisions:**
  - **The phase brief's props/events don't match the shipped component.** Brief said `highlightId` prop + `node-click` emit; the actual `graph-canvas.vue` (since Phase 2) uses `selectedNodeId` + `selectNode`. Kept the actual names — event plumbing from Phase 2 untouched.
  - **`resolveGraphNodeAction` unchanged.** Topic clicks still resolve to `noop` there; drill-down expansion is triggered separately in the page for `Concept`/`Topic` labels, so the existing `graph-node-action` unit specs stay green and Tag behavior (noop) is preserved.
  - **`mockNuxtImport('useRuntimeConfig', …)` is broken in the Nuxt test env.** The test-utils macro mocks the `#app` module; that breaks test-utils' own `setupNuxt` (`useRouter()` returns undefined → `.afterEach` throws → every test in the file is skipped). Renderer-selection coverage therefore lives in a dedicated `graph-canvas-config.nuxt.spec.ts` that `vi.mock`s the graph-renderer module and lets the real `useRuntimeConfig()` resolve (config key absent in test → `'sigma'` fallback, so the assertion is deterministic either way). Value mapping (`cytoscape`/`sigma`/unknown) is unit-tested in `graph-renderer-config.spec.ts`.
  - **Merges extracted as pure helpers** rather than inline in the page. Edge dedupe key is the directed `source|target|type|edgeType` tuple (opposite directions are distinct edges, and distinct RELATES_TO relation types between the same pair are distinct) — consistent with cytoscape's `${source}-${target}-${type}` element id.
  - **Error note is new UI** — the page previously surfaced no load errors. Dismissible note overlaid top-left of the canvas (legend occupies top-right). Unsuccessful expansions stay clickable (retry); successful-but-empty payloads (`{nodes:[],edges:[]}`) mark the node expanded so dead clicks don't refetch.
  - **Set-backed expanded state uses `ref<Set<string>>` reassigned on expansion** (Vue 3 set reactivity), while the in-flight guard is a plain non-reactive `Set`. `encodeURIComponent` applied to the node id in the query string.
