# Plan — Synced Folder Disambiguation & Aliases

Status: done
Created: 2026-08-04

## Problem

Multiple synced folders can share a basename (e.g. `/Users/x/Projects/justjom/plans` and
`/Users/x/Projects/cntctus/plans`). The notes sidebar renders only the basename → identical
rows. Graph note nodes (`plan-005-product-pages`) carry no synced-folder identity at all, and
graph→note navigation is ambiguous for collided relative paths.

## Decisions (locked with user)

1. Sidebar root label = `alias ?? basename`; on basename collision (no alias), prefix a gray
   minimal distinguishing parent path fragment (e.g. gray `justjom/` + regular `plans`).
2. `title` tooltip with full absolute path on sidebar root rows.
3. User-defined `alias` on `synced_folders` (nullable). Alias wins over collision logic.
4. Settings Synced Folders list: bold basename + gray truncated parent path; alias editing UI;
   remove duplicated description line.
5. Graph canvas: every Note node label becomes `name <rootName>` (angle brackets, e.g.
   `plan-005-product-pages <justjom>`), rootName = `alias ?? basename`. Suffix on ALL notes.
6. Graph node payload gains `syncedFolderId`; graph→note navigation passes `?syncedFolder=`.
7. concept-detail "Mentioned in notes": same `<rootName>` suffix, rendered as gray span (HTML).

## Phases

### Phase 1 — Server: alias + collision logic
- [x] Migration: nullable `alias text` on `synced_folders`; regenerate `packages/shared/types.d.ts`
- [x] `GET /api/folders`: each root returns `name` (alias ?? basename) + `pathPrefix`
      (minimal distinguishing parent segments, only for collided roots without alias)
- [x] `PATCH /api/synced-folders/:id`: update alias (trim, empty → null, max length)
- [x] Feature specs: API input → DB records + response body verified
- [x] Unit tests: distinguishing-segment algorithm edge cases
- Status: done
- Divergences:
  - The test harness provisions its template DB from `apps/web/db/schema.sql`, so
    `pnpm db:schema:dump` was required in addition to `db:migrate:generate` for the
    in-process specs to see the new `alias` column.
  - Distinguishing-segment algorithm walks up the *full parent path* (e.g. `a/x/`)
    rather than single segments, matching the spec example `a/x/plans` vs `b/x/plans`
    → `a/x/` / `b/x/`.
  - `nuxt typecheck` exits non-zero on pre-existing module config validation errors
    (`_robots.txt` crawl-delay directive, site-config localhost URL); `vue-tsc --noEmit`
    passes clean. Not introduced by this phase.

### Phase 2 — Sidebar + Settings UI
- [x] `notes-layout.vue`: render gray `pathPrefix` + `name`, `title` tooltip on root rows
- [x] `synced-folder-manager.vue`: bold basename + gray truncated parent, alias edit UI,
      remove duplicated description
- [x] i18n keys in `locales/en.json`
- [x] Component tests
- Status: done
- Divergences:
  - `GET /api/synced-folders` did not return `alias` after Phase 1, so saved aliases
    could not be displayed or survive a list refresh. Added `alias` to the list
    response (select + map) with user approval — a one-line server extension within
    Phase 2 scope.
  - The duplicated description was removed from `settings.vue` (steady-state section);
    the copy inside `synced-folder-manager.vue` is kept since that component renders it
    in both wizard and steady-state modes.
  - Alias edit errors follow the existing add/delete error-prop pattern
    (`aliasErrorId`/`aliasError` props); the editor closes optimistically on save, and
    400/404 errors surface as inline text under the row.

### Phase 3 — Graph server + navigation fix
- [x] `server/lib/graph/ui.ts` `getFullGraph`: join `synced_folders`; note nodes gain
      `rootName` (alias ?? basename) + `syncedFolderId`
- [x] `getConceptDetail`: mentioned notes gain `rootName` + `syncedFolderId`
- [x] `app/utils/graph.ts`: navigate with `?syncedFolder=`; wire through `notes/[...path].vue`
- [x] Feature specs: `GET /api/graph` note nodes include rootName/syncedFolderId
- Status: done
- Divergences:
  - `rootName` derivation lives in a shared helper `rootNameFor(path, alias)` exported
    from `server/lib/graph/ui.ts` (alias wins, blank alias → basename fallback) so the
    graph payload and the unit tests share one seam; `getFullGraph` guards notes whose
    `synced_folder_id` is NULL (rootName/syncedFolderId left undefined, so the JSON omits
    them) — the `trg_notes_default_synced_folder` trigger backfills it on insert, but
    legacy rows could still be null.
  - Navigation: `resolveGraphNodeAction` now takes a `GraphNodeInput` (adds optional
    `syncedFolderId`) and returns it on the `navigate-note` action only when present;
    `pages/graph/index.vue` appends `?syncedFolder=` (URL-encoded) and omits the query
    when absent. `graph-canvas.vue` threads `syncedFolderId` through the `selectNode`
    emit (also into the cytoscape data for Phase 4).
  - New `test/components/graph-page.nuxt.spec.ts` mounts `pages/graph/index.vue` with
    mocked `useFetch`/`navigateTo` and a stubbed `ClientOnly`/canvas to assert the full
    click → `navigateTo('/notes/...?...syncedFolder=...')` chain.
  - `nuxi typecheck` cannot run in this environment: npm (spawned by nuxi) fails with
    `EOVERRIDE Override for vue@^3.5.28 conflicts with direct dependency`, on top of the
    pre-existing `_robots.txt` / site-config localhost errors from Phase 1. Not introduced
    by this phase. Coverage relied on ESLint + unit + e2e + component suites.

### Phase 4 — Graph UI
- [x] `graph-canvas.vue`: Note node labels render `name <rootName>`
- [x] `concept-detail.vue`: gray `<rootName>` suffix in Mentioned in notes
- [x] Component tests
- Status: done
- Divergences:
  - `MentionedNote` already carried `rootName?: string` from Phase 3, so no
    prop/type change was needed in `concept-detail.vue` (the anticipated
    `rootName?: string | null` addition was unnecessary).
  - Canvas labels are asserted through the mocked cytoscape config (node style
    selector + `elements[].data.displayName`) rather than DOM, since cytoscape
    renders off-DOM. The node style label now points at `data(displayName)`;
    Concept/Topic/Tag and rootName-less notes fall back to plain `name`.
  - The new `graph-concept-detail.nuxt.spec.ts` additionally asserts the
    `openNote` emit (existing pattern in `graph-concept-list.nuxt.spec.ts`).
  - The `<rootName>` suffix uses `&lt;`/`&gt;` HTML entities in the template per
    plan decision 7, rendered as literal text content via Vue's entity decoding.

### Phase 5 — Review fixes (code review, two axes)
- [x] FIX 1 (spec, navigation): `concept-detail.vue` emits `openNote(path, syncedFolderId?)`;
      `pages/graph/index.vue` `openNote` navigates to `/notes${path}?syncedFolder=<id>`
      (URL-encoded, omitted when absent), mirroring `handleNodeClick`
- [x] FIX 2 (spec, settings label): manager row always shows bold basename + gray parent
      path; alias renders as a secondary gray `· alias` suffix, never replacing the basename
- [x] FIX 3 (standards, dedupe): `rootNameFor` moved to `server/lib/notes/disambiguation.ts`;
      `server/api/folders/index.get.ts` and `server/lib/graph/ui.ts` both import it;
      `GET /api/synced-folders` returns `basename`; manager dropped `splitPath`/`folderLabel`
- [x] FIX 4 (locale keys): audited keys touched by phases 1-4 — see divergence below
- [x] FIX 5 (naming): renamed `p` → `folderPath` in `ancestorSegments`/`distinguishingPrefix`;
      `rootNameFor` now returns the *trimmed* alias
- Status: done
- Divergences:
  - FIX 4's premise was wrong: `settings.folders.help` is not dead. Phase 2 deleted only
    the *duplicate* usage in `settings.vue`; `synced-folder-manager.vue:123` still renders
    it, and `settings-page.nuxt.spec.ts` asserts the description renders exactly once.
    User decision: keep the key and its paragraph; document the review's claim here. No
    other keys were orphaned by phases 1-4 (the 5 keys those phases added — `editAlias`,
    `aliasPlaceholder`, `save`, `cancel`, `aliasTooLong` — are all still referenced).
    `settings.folders.errors.hasNotes` is orphaned but predates this plan (007 phase 6 GC
    removed its only use) — out of scope.
  - FIX 2/3 changed the manager's `SyncedFolder` prop shape: `basename` is now required
    (computed server-side). `settings.vue` mapping and the settings-page/manager specs were
    updated to supply it. The manager derives the gray parent path by stripping the
    server-provided `basename` (handles the trailing-slash case) instead of re-splitting
    the path client-side.
  - FIX 1: `MentionedNote.path` already includes a leading `/`, so the no-synced-folder
    navigation lands on `/notes/notes/plain.md` — same semantics as before the fix.
  - One unrelated flake: `test/e2e/folder-sync.spec.ts` (chokidar smoke) failed once during
    a parallel run and passed in isolation; not introduced by this phase.
  - Full suite green: 93 files / 737 tests (unit + e2e + nuxt components), ESLint clean on
    all touched files. `nuxi typecheck` still cannot run (pre-existing overrides error, see
    Phase 3).

### Phase 6 — Bug fix: graph labels still ambiguous for collided roots
- [x] `disambiguation.ts`: new `computeRootLabels(roots) → Map<id, displayLabel>`
      (`alias ?? ((pathPrefix ?? '') + basename)`), reusing `computePathPrefixes`
- [x] `getFullGraph`: fetches ALL workspace synced folders (id, path, alias), labels via
      the helper, sets each Note node's `rootName` from the map keyed by syncedFolderId;
      NULL synced_folder_id → rootName omitted (Phase 3 behavior kept)
- [x] `getConceptDetail`: same treatment for `MentionedNote.rootName`
- [x] Unit tests: `computeRootLabels` edge cases (no collision, one-level collision,
      deep collision, alias wins, alias keeps remaining colliders disambiguated, alias trims)
- [x] Feature specs: graph note nodes carry `justjom/plans` vs `cntctus/plans` vs
      `work/plans`; alias-wins via `PATCH /api/synced-folders/:id`; collision set includes
      synced folders absent from the graph; concept-detail `mentionedIn` disambiguated
- Status: done
- Divergences:
  - User report: canvas labels showed `title <plans>` for both `justjom/plans` and
    `cntctus/plans` — the graph endpoints used only `rootNameFor(path, alias)`
    (= alias ?? basename) with no collision logic, while `/api/folders` disambiguates.
  - `rootNameFor` is kept: `GET /api/folders` still consumes it for the sidebar root
    `name` (rendered separately from `pathPrefix`), so it is not dead code.
  - The per-note `leftJoin` on `synced_folders` in `getFullGraph`/`getConceptDetail` was
    dropped — the workspace-wide `synced_folders` fetch replaces it, and the `rootName`
    lookup is keyed by `notes.synced_folder_id` directly.
  - The collision set now provably matches the sidebar: a new e2e case seeds a colliding
    `plans` folder with *no* notes or graph presence and asserts the other folder's note
    still renders `justjom/plans` (not bare `plans`).
  - No frontend changes: canvas/concept-detail already render whatever `rootName` the
    payload carries; labels automatically become `name <justjom/plans>` vs
    `name <cntctus/plans>`.
  - Suite after phase: unit 387 / e2e 244 / components 102 (733 total), ESLint clean on
    touched files.

## Key files

- `apps/web/server/lib/notes/disambiguation.ts` (shared `rootNameFor` + `computePathPrefixes` + `computeRootLabels`)
- `apps/web/server/api/folders/index.get.ts` (root label via `rootNameFor`, payload has `absolutePath`)
- `apps/web/server/api/synced-folders/*` (list response also carries `basename`)
- `apps/web/app/components/notes/notes-layout.vue` (root label at :166)
- `apps/web/app/components/settings/synced-folder-manager.vue` (bold basename + gray parent, alias suffix)
- `apps/web/server/lib/graph/ui.ts` (note node build; mentioned notes)
- `apps/web/app/components/graph/graph-canvas.vue` (label at :94)
- `apps/web/app/components/graph/concept-detail.vue` (mentioned list :69-88; openNote carries syncedFolderId)
- `apps/web/app/utils/graph.ts` (navigateTo :23-26)
