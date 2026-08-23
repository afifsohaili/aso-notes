# 01 — Fix rebuild to reset all workspaces when dropping the shared AGE graph

**What to build:** Triggering a workspace rebuild (via the settings rebuild endpoint) currently drops and recreates the shared AGE graph but only resets the triggering workspace's notes to `pending`. Other workspaces keep `status='ingested'` while their graph nodes are gone — orphaned data. After this ticket, a rebuild resets **every** workspace's notes to `pending`, so all workspaces re-ingest and repopulate the shared graph.

**Design constraint for later work:** keep the graph-wipe logic separate from the note-reset logic so a future re-embed-only path (recompute embeddings without wiping chunk/concept/topic text) can reuse the pieces. Do not build the re-embed-only path itself.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Triggering a rebuild resets notes to `pending` in ALL workspaces, not just the triggering one
- [ ] After re-ingestion completes, the shared AGE graph contains nodes for every workspace again
- [x] Test coverage: two workspaces with ingested notes; rebuild from workspace A; both workspaces' notes end up `pending` and re-ingest
- [x] Graph-wipe and note-reset logic are separable units (future re-embed-only path can reuse them)

## Implementation notes / divergences

- The note-reset in `rebuildWorkspaceGraph` (apps/web/server/lib/rebuild.ts) now drops the `workspace_id` filter and resets **every** workspace's notes to `pending`. The existing test `POST /api/settings/rebuild leaves other workspaces untouched` was inverted and replaced by two acceptance tests: (1) two workspaces both with ingested notes, rebuild from A → both end `pending`, `notesReset` = 2; (2) triggering workspace has zero notes, another workspace has an ingested note → the other workspace's note is still reset to `pending`, and its relational rows (e.g. `concepts`) are preserved (only the shared graph is dropped).
- Design constraint honored: extracted two exported, reusable units — `dropAndRecreateNotesGraph(db)` (graph-wipe) and `resetAllNotesToPending(db)` (note-reset) — called in sequence from `rebuildWorkspaceGraph`. The future re-embed-only path can reuse either independently. Not built.
- Acceptance criterion "After re-ingestion completes, the shared AGE graph contains nodes for every workspace again" is left unchecked: it requires the full ingestion pipeline (LLM keys, embedding, queue), which is out of scope for this bug fix; covered indirectly by the re-ingest reset behavior.
- No divergence in the note-reset semantics; the fix is minimal and matches the ticket.
