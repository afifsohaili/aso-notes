---
type: wayfinder:research
claimed: research-subagent (2026-07-30)
status: closed (2026-07-30)
blocked-by: []
---

# Embedding dims detection

## Question

What is the cheapest reliable way to detect an embedding model's output dimensions per provider, to power the locked decision "validate dims at save time, reject non-2048"?

Facts to surface:

- OpenRouter: does the models API (`GET /api/v1/models` or similar) expose embedding output dimensions per model? If not, is a probe embed call (one tiny input, measure vector length) the answer, and what does it cost?
- Ollama: does `/api/show` (or another endpoint) expose embedding dimensions for a model? Probe-embed fallback shape (`/api/embed` / `/api/embeddings` request/response).
- Any gotchas: models that report one dim but truncate (Matryoshka / dimension-parameter models), providers that error on empty input, latency expectations for a probe call.

Findings determine the `POST /api/settings/test-connection` embedding branch design (metadata lookup vs probe call, per provider).

Resolution feeds: Author plan-007. Capture findings in `research-embedding-dims.md` in this directory and link from the resolution comment.

## Resolution (2026-07-30)

Findings: `notes/aso-notes/007-onboarding/research-embedding-dims.md` — committed on branch `research/embedding-dims-detection` (commit 4d906cd). Read via `git show research/embedding-dims-detection:notes/aso-notes/007-onboarding/research-embedding-dims.md`.

Answer:

- **OpenRouter**: no dimension metadata anywhere (verified live; embedding models require `?output_modalities=embeddings` on the models list). Probe call mandatory: `POST /api/v1/embeddings`, measure `data[0].embedding.length`, negligible cost.
- **Ollama**: partial metadata — `POST /api/show` exposes `model_info["<arch>.embedding_length"]` + a `capabilities` array (gate on `"embedding"`), but it's a heuristic; probe is ground truth (`POST /api/embed`, `{model, input}` → `embeddings[0]`).
- **Design for test-connection**: probe-always at save time for both providers — one tiny non-empty input, no `dimensions` param, accept iff length == 2048. Cheap pre-flights: OpenRouter models-list membership; Ollama capabilities gate. Cache dims per (provider, model id).
- **Gotchas**: probes return DEFAULT dims (matryoshka models return 1536/3072 without the `dimensions` param — correct for us, since the pipeline never sends it); most popular hosted embedding models are NOT 2048-dim, so expect frequent rejects and design error copy accordingly; empty input can 400; OpenRouter routes one model id across multiple upstreams; Ollama cold model loads take seconds → probe timeout ≥30s.
