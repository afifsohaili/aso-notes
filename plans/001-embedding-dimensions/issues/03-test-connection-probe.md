# 03 — Test-connection probe accepts any model that can reach 2048

**What to build:** The settings test-connection probe currently rejects any model that doesn't return exactly 2048 dims, which blocks Matryoshka-capable models probed without a dimensions param and sub-2048 paddable models. After this ticket, the probe sends its test embedding request with `dimensions: 2048` and accepts: native 2048 output, truncated-to-2048 output, and any output shorter than 2048 (paddable). It rejects models whose native output exceeds 2048 with a clear, user-facing error explaining the model is unsupported.

**Blocked by:** 02 — Embedding provider contract: embed() always returns 2048 dims

**Status:** done

- [x] Probe request includes `dimensions: 2048`
- [x] Saving an embedding model succeeds for native-2048, Matryoshka-truncatable, and sub-2048 paddable models
- [x] Models with native output >2048 are rejected with a clear error message
- [x] Tests stubbing provider responses cover each accept/reject case

## Implementation notes / divergences

- The endpoint previously hand-rolled the ollama/oMLX probe bodies (raw `fetch` without `dimensions`, manual 2048 check) and only used the adapter for OpenRouter. Now **all three providers go through the shared adapter's `embed()`**, which is exactly what Phase 2 normalized. It requests `dimensions: 2048`, zero-pads sub-2048 output, and throws on native output >2048. So a successful `embed()` call *is* the acceptability check — the endpoint no longer re-validates dims itself and the `dims`/`expected` return shape is dropped.
- The >2048 case surfaces as the adapter's `normalizeEmbeddingDimensions` throw. The endpoint matches that error message (`above the`) and maps it to a clear, user-facing `{ ok: false, error }` explaining the model's native output exceeds the supported 2048 and it is unsupported. This is a 200 outcome like the other probe validation outcomes, not a 500.
- Review fix (typed error): the fragile message sniff (`err.message.includes('above the')`) was replaced with a dedicated `OverDimensionsError` class exported from `normalize-embedding.ts`; the endpoint catches it with `instanceof`, and the util's unit tests assert the thrown type.
- Removed the now-unused `fetchWithTimeout` helper.
- The frontend `dims` status branch (`settings-wizard.vue`, `llm-providers.vue`) is now effectively unreachable for embeddings but was left untouched — out of scope; it still handles the `error` branch for the >2048 message.
