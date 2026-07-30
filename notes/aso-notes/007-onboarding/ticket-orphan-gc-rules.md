---
type: wayfinder:grilling
claimed: 2026-07-30
status: closed (2026-07-30)
blocked-by: [ticket-synced-folder-data-model.md]
---

# Orphan GC rules

## Question

Removing a Synced Folder wipes its notes (locked). Exactly which derived rows get garbage-collected, and how, given concepts/relations/topics may be shared with notes from other synced folders?

Sub-questions to resolve:

- GC unit: delete the root's notes + chunks + mentions, then which orphans die? Concepts with zero remaining mentions; relations touching a dead concept; topics with zero remaining concepts; AI tags on deleted notes (cascade); links/sources rows.
- AGE mirror cleanup: which vertices/edges are removed, in the same transaction (mirror discipline from plan-003)?
- Does GC run inline in the remove-folder endpoint (single transaction) or as a follow-up job?
- Interplay with re-ingestion: a concept that survives (still mentioned elsewhere) keeps its embedding/description — any description/embedding staleness concerns? (Suspected: no, matches existing never-overwrite rule.)
- User tags and `note_tag_dismissals` on wiped notes: preserved anywhere, or gone with the note? (Rebuild machinery preserves user tags workspace-wide; partial wipe semantics need pinning.)
- UX guard for removal: type-to-confirm like REBUILD, show affected note count first?

Context: plan-003 M3/M7 (store-graph transaction, rebuild endpoint `POST /api/settings/rebuild`), plan-004 status machine. Depends on the Synced Folder data model resolution for the relational shape.

Resolution feeds: Author plan-007.

## Resolution

- **GC unit**: The synced folder's Notes are deleted first. DB cascades remove chunks, mentions, links, sources, AI tags, and `note_tag_dismissals` tied to those notes. After that, Concepts with zero remaining mentions are removed, Relations touching a removed Concept are removed (via FK cascade), and Topics with zero remaining Concepts are removed.
- **AGE mirror cleanup**: For every deleted Note, dead Concept, and orphaned Topic, the corresponding vertex and all incident edges are removed in the same transaction. This follows the plan-003 same-transaction mirror discipline.
- **Execution model**: GC runs inline in `DELETE /api/synced-folders/:id`, wrapped in a single transaction (savepoint when already inside a host transaction, matching the rebuild endpoint precedent). No follow-up job.
- **Re-ingestion / staleness**: A Concept that survives keeps its existing embedding and description untouched. This matches the existing never-overwrite rule; no staleness handling.
- **User tags and dismissals**: Both user-origin `note_tags` rows and `note_tag_dismissals` rows for wiped Notes are deleted with the Note (FK `ON DELETE CASCADE`). This differs from a full rebuild, which preserves user tags workspace-wide; partial wipe intentionally scopes deletion to the removed folder's Notes.
- **UX guard**: The folder manager shows a type-to-confirm dialog that displays the affected note count and requires typing `REMOVE` before the confirm button enables, mirroring the REBUILD danger-zone pattern.
