---
type: wayfinder:grilling
claimed:
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
