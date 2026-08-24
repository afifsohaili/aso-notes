# Plan: oMLX LLM Provider (012)

## Goal

Add `omlx` as a third LLM provider kind (alongside `openrouter` and `ollama`) so the app can use a local macOS MLX inference server for agent, extraction, and embedding roles. The work is documentation-only in this final phase; Phases 1-3 are implemented and committed.

## Background

oMLX (omlx.ai) is a macOS-native MLX inference server. It exposes an OpenAI-compatible API at `http://localhost:8000/v1` with no API key by default. It supports `/v1/chat/completions` and `/v1/embeddings`.

The app previously supported `openrouter` (remote, paid) and `ollama` (local). `omlx` was added as a third provider kind. It is a dev-machine local provider: macOS-only (Apple Silicon, macOS 15+). Production stays on OpenRouter.

## Plan as originally scoped

- **Provider kind**: add a new `omlx` provider kind rather than generalizing to a generic openai-compatible provider. This keeps zero risk to existing provider paths.
- **Roles**: support `omlx` for the agent, extraction, and embedding roles. The consolidation role falls back to the extraction config (existing pattern, no change).
- **Embedding strategy**: zero-pad short vectors to `EMBEDDING_DIMENSIONS = 2048` (like ollama) rather than migrating the graph store to 1024. This keeps the graph store unchanged.
- **Configurability**: `base_url` is the seam for remote Macs. Default is `http://localhost:8000/v1`; a remote Mac uses a custom `base_url`. API-key auth is supported: the per-role `NUXT_LLM_*_API_KEY` env var is sent as `Authorization: Bearer` when set (oMLX main key or sub-key); an unauthenticated oMLX server works with no key.
- **Model**: `omlx` requires an explicit model (no default), like ollama.

## Implementation status per phase

### Phase 1 — Provider classes and registry integration (done, `b0ca724`)

Built:

- `apps/web/server/lib/ai/omlx.ts`:
  - `OmlxLLMProvider` — OpenAI `/chat/completions` wire format, tool_calls, response_format, usage, finish_reason; `Authorization: Bearer` header when an api key is configured.
  - `OmlxEmbeddingProvider` — `/embeddings`; zero-pads short vectors to `EMBEDDING_DIMENSIONS = 2048`, errors if longer; `Authorization: Bearer` header when an api key is configured.
- `apps/web/server/lib/ai/registry.ts`:
  - `ProviderKind` gains `'omlx'`.
  - Default `OMLX_BASE_URL = 'http://localhost:8000/v1'`.
  - Model required; API key optional (env `NUXT_LLM_*_API_KEY` passed through).

Tests:

- `apps/web/test/unit/omlx.spec.ts`
- `apps/web/test/unit/ai-registry.spec.ts`

### Phase 2 — Settings, test-connection, providers availability, tracing (done, `4ddd217` + `9de839c`)

Built:

- `apps/web/server/lib/settings.ts` — `VALID_LLM_PROVIDERS` gains `'omlx'`; default base_url resolution.
- `apps/web/server/api/settings/test-connection.post.ts` — accepts `omlx` (30s timeout); embeddings probed via `POST ${base}/embeddings`; dims checked against 2048.
- `apps/web/server/lib/observability/traced-provider.ts` — treats `omlx` as free/local like ollama (not `usageMissing`).
- `apps/web/server/api/settings/providers/index.get.ts` — returns `omlx: true` per role.

Tests:

- `settings.spec`, `test-connection.spec` (e2e), `traced-provider.spec`, `settings-providers.spec` (e2e), `omlx.spec`, `ai-registry.spec` — 138 unit + 14 e2e passing.

### Phase 3 — Settings UI and env docs (done, `3d726d1`)

Built:

- `apps/web/app/components/settings/llm-role-card.vue` — dropdown gains `'oMLX'` option; `ProviderAvailability.omlx`.
- `apps/web/app/pages/settings/llm-providers.vue` and `apps/web/app/components/settings/settings-wizard.vue` — `DEFAULT_PROVIDER_AVAILABILITY` gains `omlx: true`.
- `apps/web/.env.example` — omlx docs for agent/extraction/embedding roles.

Tests:

- Component tests: 18 passing (3 spec files).

### Phase 4 — Planning doc (done, this phase)

- This document.

## Divergences from plan

- **Model-required error message** interpolates the provider kind, so the message text differs per provider rather than being a single shared string.
- **No `embedWithUsage`** on the embedding provider. The omlx embedding provider does not implement `embedWithUsage`; only the metadata-only embedding path is used.
- **`.env.example` has no CONSOLIDATION role block** — only the three roles (agent, extraction, embedding) are documented, matching the file's existing precedent.
- **`nuxt typecheck` is broken repo-wide pre-existing** (npm EOVERRIDE) — not caused by this work.
- **Embedding zero-padding chosen over graph-store migration** — zero-padded embeddings (1024 BGE-M3) vs native 2048 carry a slight quality cost, the same tradeoff ollama makes. The graph store was left unchanged.
