# 09 — Refactor: shared test stubs, generic hybrid helper, clean schema dump

**What to build:** Pure refactor — no behavior change, suites stay green throughout. (1) The seed/stub helpers (`givenWorkspace`/`givenNote`/`givenChunk`/`givenConcept`/`vec`/`stubEmbedding`/`stubContext`) are copy-pasted across the three new retrieval specs (and near-identical in `agent-tools.spec.ts`) — extract them into one shared test helper module and import it from all retrieval specs; migrating the pre-existing `agent-tools.spec.ts` is optional, do it only if low-risk. (2) `hybridSearchChunks` and `hybridSearchConcepts` repeat the identical fuse→merge→slice→map pattern with structurally duplicated row types — collapse into one generic helper with one row type per leg. (3) `excludedNoteIds` takes a whole note-grouping Map just to read its keys — change the signature to accept the list of paths/ids it actually needs. (4) `db/schema.sql` carries unrelated `\restrict`/timestamp-default noise from dump regeneration — produce a clean dump so the file only reflects real schema.

**Blocked by:** 06, 07, 08 (refactor lands on top of all behavior fixes).

**Status:** done

- [x] One shared test-helper module; the three retrieval specs import from it; no duplicated seed/stub code between them
- [x] One generic hybrid-search helper backs both chunk and concept hybrid search; duplicated row types collapsed
- [x] `excludedNoteIds` (or successor) takes only the paths/ids it uses
- [x] `schema.sql` contains only real schema (no `\restrict` token or timestamp-default churn); document in ticket notes how the clean dump was produced
- [x] Full e2e + unit suites green; typecheck + lint clean; zero behavior change

## Implementation notes / divergences

### Shared test stubs
Extracted the duplicated seed/stub helpers into `apps/web/test/e2e/agent-stubs.ts` (`givenWorkspace`/`givenNote`/`givenChunk`/`givenConcept`/`vec`/`stubEmbedding`/`stubContext`). All three retrieval specs import from it. `agent-tools.spec.ts` was migrated too — it was low-risk (identical helpers, same import path), so no duplication remains anywhere.

### Generic hybrid helper
`hybridSearchChunks` and `hybridSearchConcepts` now both delegate to one private generic `hybridSearch<T>` that runs the fuse→merge→slice→map pipeline. The duplicated per-leg row types (`DenseRow`/`LexicalRow`, `ConceptDenseRow`/`ConceptLexicalRow`) collapsed into `ChunkCandidateRow`/`ConceptCandidateRow`. Public exports `hybridSearchChunks`/`hybridSearchConcepts` and the `HybridChunkRow`/`HybridConceptRow` types are unchanged, so existing callers (`search-notes.ts`, `search-concepts.ts`, `retrieval/index.ts`) are untouched.

### `excludedNoteIds` signature
Now takes `paths: string[]` instead of the whole note-grouping `Map`. The caller passes `[...byNote.keys()]`. Behavior identical.

### `schema.sql` noise — root cause and fix
Two independent noise sources, both now resolved:

1. **`\restrict`/`\unrestrict` token** — pg_dump 16.15 emits a random session-scoped security key on every run. Inherent to the dump tool. Fixed by post-processing in `apps/web/scripts/dump-schema.ts`: strip the `\restrict` line after the header and the trailing `\unrestrict` line. The committed file is now deterministic across runs.

2. **Timestamp-default churn** — the two notification migrations (`1752826481000_create_notifications_table.ts`, `1752826482000_create_read_notifications_table.ts`) used `defaultTo('now()')`, which Kysely treats as a *string literal*, baking a literal timestamp into the column default at migration time. Every dump therefore produced a fresh timestamp. Fixed by changing to `defaultTo(sql\`now()\`)` (matching the rest of the codebase), so the default is the `now()` function and the dump is stable.

**Divergence from "zero behavior change":** fixing the timestamp churn required changing the DB default from a literal timestamp to `now()`. This was confirmed with the user and is the clearly-intended behavior (the other ~20 timestamp columns already use `sql\`now()\``). No runtime behavior change for the app; only the stored default expression differs.

### Verification
- `pnpm test:e2e` — 53 files / 385 tests green
- `pnpm --filter web vitest run test/unit/rrf.spec.ts` — 8 tests green
- `pnpm typecheck` — exit 0
- `pnpm exec eslint` on all changed files — clean
