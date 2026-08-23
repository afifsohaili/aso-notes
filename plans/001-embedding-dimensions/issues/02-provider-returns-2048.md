# 02 — Embedding provider contract: embed() always returns 2048 dims

**What to build:** The canonical embedding width is 2048, locked as a code constant. Today providers return whatever the model natively emits. After this ticket, every embedding provider adapter guarantees 2048-dim output: it requests `dimensions: 2048` from the provider API (native Matryoshka truncation where supported), and if the provider ignores that and returns fewer than 2048 dims, a shared normalize util zero-pads the vector to 2048. Native output longer than 2048 throws a clear error — such models are unsupported. The 2048 invariant is documented on the embedding provider type. Zero-padding is retrieval-safe: cosine distance is unchanged when both stored and query vectors are padded consistently, and all retrieval is workspace-scoped.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] OpenRouter, Ollama, and OmLX adapters all request `dimensions: 2048`
- [x] A shared normalize util pads short vectors to 2048 and throws on vectors longer than 2048
- [x] The embedding provider type documents the 2048-dim output invariant
- [x] Unit tests: provider stub returning 768 dims → 2048-dim padded output; 2048 dims → passthrough; 4096 dims → throws
- [x] Existing 2048 validation in the embedding/storage pipeline stages still passes unchanged (safety net)

## Implementation notes / divergences

- Added `server/lib/ai/normalize-embedding.ts` exporting `normalizeEmbeddingDimensions(vector, target = EMBEDDING_DIMENSIONS)`. It zero-pads vectors shorter than 2048, passes through exactly-2048 unchanged (returns the same array reference), throws a clear error above 2048. Exported via `server/lib/ai/index.ts`.
- OpenRouter adapter: now sends `dimensions: 2048` in the request body and routes responses through the util in `toEmbeddingResult`. It previously had no dimensions handling.
- Ollama adapter: already sent `dimensions` and had private `fitDimensions`; refactored to call the shared util (DRY). Default width unchanged (2048).
- OmLX adapter: previously did **not** send a `dimensions` param (comment said oMLX returns full dims). Divergence from ticket intent: now sends `dimensions: this.dimensions` in the request body (matching the "request 2048" requirement) and routes through the shared util. The old test asserting `dimensions` is absent was replaced.
- Existing 2-dim passthrough tests in `openrouter.spec.ts` were updated to 2048-dim vectors since adapters now always normalize; the retry/resilience tests were about backoff, not dimensionality, so their fixtures were widened to 2048.
- The `test-connection` endpoint probes Ollama/OmLX with a raw fetch (no `dimensions` param) and remains a genuine dimension-safety check — its non-2048 e2e tests are unaffected and still pass.
- The safety-net validations in `server/lib/pipeline/stages/embed-chunks.ts` and `store-graph.ts` are untouched.
- Ran: full `unit` project (504 tests), the `settings-test-connection` e2e spec (11 tests), eslint on all touched files, and `pnpm typecheck` (clean).
