# 01 — Add pg_search to the Postgres image

**What to build:** The project's Postgres Docker image (Postgres 16, already carrying pgvector and Apache AGE) also carries the ParadeDB pg_search extension, pinned to a specific version and installed from its prebuilt PG16 package — no Rust toolchain in the image. A migration creates the extension in the database, so dev, test (template DB), and prod all have BM25 search available. After this ticket, running migrations against a fresh volume yields a database where a BM25 index can be created and a match query runs.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Docker image builds with pg_search installed at a pinned version alongside pgvector and AGE
- [x] Migration creates the pg_search extension (idempotent: `if not exists`)
- [x] The pinned version's query/scoring syntax is verified against that version's docs and noted in the migration or a code comment
- [x] Test coverage: transactional test proves the extension exists and a small BM25 index + match query round-trips
- [x] Dev setup docs (README/AGENTS notes if applicable) mention the volume must be recreated to pick up the new image

## Implementation notes / divergences

- **Pinned version:** pg_search `0.25.3` (newest release with a prebuilt PG16 bookworm `.deb`). Asset: `postgresql-16-pg-search_0.25.3-1PARADEDB-bookworm_<arch>.deb`.
- **Verified query syntax (0.25.x):** the API was renamed from the 0.15–0.17 era. Index access method is `paradedb` (alias `bm25`), requires `key_field`; the match operator is `|||` (disjunction) / `&&&` (conjunction) — **not** `@@@`; scoring is `pdb.score(<key_field>)`. Recorded in the Dockerfile comment and the migration.
- **Divergence — `shared_preload_libraries`:** `CREATE EXTENSION pg_search` fails unless `pg_search` is in `shared_preload_libraries`. This is a runtime config, not an image-install concern, so it is set via the `db` service `command` in `docker-compose.yml` (`postgres -c shared_preload_libraries=pg_search`). The ticket did not mention this; it is required for the extension to load.
- **Divergence — architecture:** the deb is selected by `TARGETARCH` (declared as an `ARG` in the final stage) so the image builds on both amd64 and arm64 hosts. The ticket only named the amd64 asset.
- **Volume recreation:** required to pick up the new image (the extension is baked into the image, not the data volume). `docker compose down -v && docker compose up -d db` was run; dev data was wiped, which the user confirmed is acceptable.
