# 08 — Trim scope creep from retrieval module and search_notes

**What to build:** The review found three unrequested behaviors. After this ticket: (1) the RRF fuser loses its per-list `weights` and `k` options — spec decision 2 asks only for a pluggable strategy parameter (which stays), and weighted fusion is explicitly out of scope; (2) `relatedLimit` drops the unrequested `0`-disables-expansion behavior — valid range becomes 1–10 with default 3, clamped like `limit`; (3) the merging of related Note paths into the `notes` citations array is KEPT — reviewed and accepted as defensible (the Agent should cite graph-expanded Notes); record this decision in the ticket notes.

**Blocked by:** 06 — Traverse RELATES_TO undirected (touches the same expansion code); 07 — provenance matched Chunk (same).

**Status:** done

- [x] `rrfFuse` has no `weights`/`k` parameters; the `FusionStrategy` strategy parameter remains; `'weighted'` still throws
- [x] Unused `RankedItem` index-signature passthrough removed if no caller uses it
- [x] `relatedLimit` schema minimum is 1 (default 3, max 10); the Phase-4 test asserting 0-disables is replaced with clamping behavior tests
- [x] Decision recorded: related Note paths stay in the `notes` citations array
- [x] Full e2e + unit suites stay green

## Implementation notes / divergences

- **Citations merge (decision):** merging related Note paths into the `notes` citations array is KEPT. Reviewed and accepted as defensible — the Agent should be able to cite graph-expanded Notes. No code change; the existing `result.notes` return already appends `relatedPaths`.
- **`rrfFuse` / `fuseRankedLists`:** removed the `weights` and `k` options. RRF `k` is now the internal constant `RRF_K = 60`. The `FusionStrategy` strategy parameter remains and `'weighted'` still throws. The `RankedItem` index-signature passthrough was removed — verified no caller uses it (all callers pass `{ id }` only).
- **`relatedLimit`:** minimum is now 1 (default 3, max 10), clamped like `limit` (`Math.max(1, Math.min(10, ...))`). The `0`-disables-expansion special case is gone; the `relatedLimit > 0` guard in `execute` was simplified to `notes.length > 0`. The Phase-4 test asserting 0-disables was replaced with a clamping test (0 → 1 still surfaces the neighbor). Tool schema description updated to drop the "0 disables expansion" wording.
- **Tests:** `rrf.spec.ts` dropped the per-list weights test and added a default-strategy test; `search-notes-graph-expansion.spec.ts` replaced the 0-disables test with a clamp-to-min test. Full e2e (385 tests) and unit suites green; typecheck and lint clean.
