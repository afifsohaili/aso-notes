# Notes routing refactor — plan

Goal: replace the SPA-style `/notes?note=<path>` selection with real Nuxt pages that render universally.

## URL scheme

| Resource | Old URL | New URL |
|----------|---------|---------|
| Notes home | `/notes` | `/notes` (unchanged) |
| Folder view | `/notes?note=<folder>` (only visually selected folder) | `/notes/<folder>` |
| Note detail | `/notes?note=<note>` | `/notes/<note>` |

Examples:
- Folder: `/notes/aso-notes/003-topics-concepts`
- Note: `/notes/aso-notes/003-topics-concepts/plan-003-notes-routing.md`

## Decisions

1. **Catch-all page**: `app/pages/notes/[...path].vue` resolves the route segments to either a folder or a note.
2. **Path resolution**: add a pure `resolveNotesRoutePath(rawPath, knownFolders, knownNotes)` helper plus a `GET /api/notes/resolve?path=<path>` endpoint that returns `{ type: 'note' | 'folder' | 'not_found', path, folder? }`.
3. **Index redirect**: `app/pages/notes/index.vue` keeps working as the default state; if `?note=` is present it redirects client-side to the canonical URL.
4. **Navigation refactor**: keep the existing three-pane component events (`select` from folder-tree and note-list); the page now calls `navigateTo('/notes' + path)` instead of mutating local state. This preserves the existing layout without redesigning the components.
5. **Internal links**: update `chat-thread.vue`, `notes/queue.vue`, and `graph/index.vue` to build `/notes/<path>` links.
6. **Universal rendering**: fetch resolution, folders, note list, and note detail via `useAsyncData` / `useFetch` keyed on the route so SSR renders the right state and client navigation is preserved.

## Build order

1. Pure path-resolution helper + unit tests.
2. `GET /api/notes/resolve` endpoint + e2e tests.
3. Update internal link builders (chat-thread, queue, graph) + component tests.
4. Catch-all page + index redirect; component tests for folder and note states and for the `?note=` redirect.
5. Run full suite + lint.
6. Update this plan with status and divergences.

## Status

DONE — 2026-07-30

- `app/pages/notes/[...path].vue` catch-all page resolves routes to folder or note, fetches via `useAsyncData`, and delegates to a shared `NotesLayout`.
- `app/pages/notes/index.vue` keeps the default state and redirects `?note=<path>` to `/notes/<path>` client-side.
- New `GET /api/notes/resolve?path=<path>` endpoint returns `{ type: 'note' | 'folder' | 'not_found', path, folder? }`.
- New pure `resolveNotesRoutePath(rawPath, knownFolders, knownNotes)` helper (in `server/lib/notes/paths.ts`) with unit coverage for folder/note/not-found, trailing slashes, encoded characters, and root-level notes.
- Internal link builders updated to `/notes/<path>` in chat-thread, notes queue, and graph page.
- Shared `app/components/notes/notes-layout.vue` extracted to keep the three-pane UX identical; folder-tree and note-list got data-testids for navigation assertions.
- Tests: 8 new e2e specs for `/api/notes/resolve`, 6 new component specs for the index/catch-all pages, 9 new unit specs for path resolution, 2 updated component specs for internal link URLs.

### Divergences

- The existing index page used a local `startEditingNewNote` flag to begin editing a brand-new note. After the routing refactor, the create-note flow navigates to the new canonical URL with `?edit=1` and the page passes that intent to `NoteDetail`; the query is removed once editing starts. This preserves the auto-edit behavior while keeping state URL-addressable.
- Typecheck (`nuxt typecheck`) fails in this environment with an unrelated npm/vue override conflict, so verification relied on the full Vitest suite and lint instead.

### Test counts

Full suite: **515 passed, 4 skipped** (baseline 492 passed, 4 skipped).
