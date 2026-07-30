---
type: wayfinder:grilling
claimed:
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
