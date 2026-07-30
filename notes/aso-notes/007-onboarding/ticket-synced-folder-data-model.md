---
type: wayfinder:grilling
claimed: phase-2-subagent (2026-07-30)
status: closed (2026-07-30)
blocked-by: []
---

# Synced Folder data model

## Question

How do Synced Folders map into the existing folders/notes tree, and what is the exact relational shape?

Sub-questions to resolve:

- Does `notes` gain a `synced_folder_id` FK (paths relative per-root), or does each Synced Folder correspond to a root row in `folders` that carries the FK?
- Note path uniqueness: currently unique per workspace; with N roots the same relative path can exist in two roots. Composite `(synced_folder_id, path)` uniqueness?
- `synced_folders` table columns: id, workspace_id, path (absolute, unique per workspace), display name?, timestamps. Anything else (last-scan-at, status)?
- Does the `resolveSyncWorkspace` "first workspace in DB" hack stay as-is for the single-tenant MVP?
- How do two roots display in the notes UI (separate top-level trees? prefix?)?
- Rename/move semantics: editing a synced folder's path = remove + add (wipe + rescan), or a gentler path-update?

Context: `apps/web/server/lib/sync/{files,paths,watcher,sweeper}.ts` all take a single `notesDir` today; `folder structure mirrors disk` (product.md decision 5); `resolveSyncWorkspace` in `server/lib/sync/workspace.ts`.

Resolution feeds: Orphan GC rules (blocked on this), Author plan-007.

## Resolution

- `notes` gets a `synced_folder_id` FK (NOT NULL after backfill). Paths are relative to the root, so note uniqueness is composite `(synced_folder_id, path)`. `folders` is left workspace-scoped in this phase; the same relative folder path from two roots maps to one `folders` row. This is an interim simplification — it keeps the tree API working, but it means a root `__folder-cover.md` from two Synced Folders would collide on the same folder row. Phase 4 UI may revisit this.
- `synced_folders` columns: `id` (uuid, default), `workspace_id` FK, `path` (text, absolute), `created_at`/`updated_at`. Unique on `(workspace_id, path)`. No display name, last-scan, or status columns for now — the UI can derive display from the basename and the sync state from notes.
- `resolveSyncWorkspace` stays exactly as-is (single-tenant MVP: first workspace by `created_at`). The sync plugin iterates every `synced_folders` row for that workspace.
- Two roots display in the notes list as a single merged list (notes from all roots). Duplicate relative paths from different roots are returned as-is; this is a known UI quirk for Phase 4 to disambiguate (likely by adding a root prefix or grouping).
- Rename/move semantics: there is no edit endpoint for a Synced Folder path. Changing the path means deleting and re-adding, which will be a wipe + rescan. Phase 6 may revisit a gentler path update.
- Migration backfill: clean break, no real installs. The migration creates one default `synced_folders` row per workspace. If `NUXT_NOTES_DIR` is set at migration time, that path is used; otherwise a placeholder `__default_synced_folder__` path is used. Existing notes are attached to that row. A `BEFORE INSERT` trigger provides a fallback `synced_folder_id` from the workspace's first Synced Folder (creating a placeholder if none exists), so legacy/test fixtures that omit the column continue to work while application code always supplies it explicitly.
- Interim removal behavior: `DELETE /api/synced-folders/:id` returns `409` if the folder has any notes. Phase 6 will replace this with full orphan GC (wipe notes + graph rows).
