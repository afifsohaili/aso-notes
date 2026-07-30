# Research: detecting embedding output dimensions per provider

Context: DB column is `halfvec(2048)` (schema-baked). Settings let users pick an embedding model
per provider (OpenRouter or Ollama). We must reject non-2048 models at save time. This file
answers: can we read dims from provider metadata, or must we probe?

## 1. OpenRouter

### Metadata — NO dimensions field exists

`GET https://openrouter.ai/api/v1/models` (public, no key needed) by default returns **only
non-embedding models** (367 entries, zero with embeddings output). Embedding models must be
requested explicitly with a filter:

```
GET https://openrouter.ai/api/v1/models?output_modalities=embeddings
```

That returns 34 embedding models (as of 2026-07-30), e.g. `openai/text-embedding-3-small`,
`openai/text-embedding-3-large`, `google/gemini-embedding-001`, `qwen/qwen3-embedding-8b`,
`nvidia/llama-nemotron-embed-vl-1b-v2:free`, `mistralai/codestral-embed-2505`, voyageai models.

Full field list per model (verified live): `architecture`, `canonical_slug`, `context_length`,
`created`, `default_parameters`, `description`, `expiration_date`, `hugging_face_id`, `id`,
`knowledge_cutoff`, `links`, `name`, `per_request_limits`, `pricing`, `reasoning`,
`supported_parameters`, `supported_voices`, `top_provider`. The only signal is
`architecture.modality: "text->embeddings"` / `output_modalities: ["embeddings"]` — **no field
gives vector dimensions**. `supported_parameters` is `[]` for the embedding models checked.

The per-model endpoints detail (`GET /api/v1/models/{author}/{slug}/endpoints`, e.g.
`/models/openai/text-embedding-3-small/endpoints`) also has **no dimensions field** — only
`context_length`, `pricing`, `provider_name`, `supported_parameters`, uptime/latency stats.
(Side note: dims are sometimes mentioned in the free-text `description`, e.g. voyage-4's
description lists "2048, 1024, 512, and 256 dimensions" — not machine-readable, don't parse it.)

**Verdict: probe is required.**

### Probe fallback — POST /api/v1/embeddings (OpenAI-compatible)

```
POST https://openrouter.ai/api/v1/embeddings
Authorization: Bearer <key>
{
  "model": "openai/text-embedding-3-small",
  "input": "dimension probe"
}
```

Response (OpenAI embeddings shape):

```json
{
  "object": "list",
  "data": [
    { "object": "embedding", "index": 0, "embedding": [0.0123, -0.0456, ...] }
  ],
  "model": "openai/text-embedding-3-small",
  "usage": { "prompt_tokens": 2, "total_tokens": 2 }
}
```

Detect dims = `response.data[0].embedding.length`.

Cost: priced per input token; text-embedding-3-small is `$0.00000002`/token (=$0.02/1M), so a
~2-token probe is ≈ $0.00000004 — negligible. `:free` variants exist (e.g.
`nvidia/llama-nemotron-embed-vl-1b-v2:free`, `nvidia/nemotron-3-embed-1b:free`) at $0.
Latency: one tiny call is sub-second to ~1s depending on provider; not streaming.

## 2. Ollama

### Metadata — partially YES via `POST /api/show`

```
POST http://localhost:11434/api/show
{ "model": "nomic-embed-text" }
```

Response fields include:

- `model_info`: flat map of GGUF metadata, including `"<architecture>.embedding_length"`,
  e.g. `"nomic-bert.embedding_length": 768`. This is the model's embedding width and matches the
  default output dims for standard embedding models (nomic-embed-text → 768,
  mxbai-embed-large → 1024, all-minilm → 384).
- `capabilities`: array, e.g. `["completion", "vision"]`; embedding-capable models list
  `"embedding"` — useful as a cheap pre-flight "is this even an embedding model" check.
- `details.family`, `details.parameter_size`, etc. — no dims.

Caveats: `embedding_length` is hidden-state width, not guaranteed to equal the projected output
dims for models with a projection layer, and it doesn't reflect matryoshka truncation (see
§3). So it's a strong heuristic, not ground truth. The key name varies by architecture
(`nomic-bert.embedding_length`, `bert.embedding_length`, `llama.embedding_length`, ...) — scan
`model_info` for any key ending in `.embedding_length`.

### Probe fallback

Newer endpoint (batch-capable, stable since ~v0.1.35/2024, docs call it the primary interface):

```
POST http://localhost:11434/api/embed
{ "model": "nomic-embed-text", "input": "dimension probe" }
```

```json
{
  "model": "nomic-embed-text",
  "embeddings": [[0.0100, -0.0017, ...]],
  "total_duration": 14143917,
  "load_duration": 1019500,
  "prompt_eval_count": 8
}
```

dims = `response.embeddings[0].length`. `/api/embed` also accepts an optional `dimensions`
param (matryoshka reduction) and returns L2-normalized vectors.

Older endpoint (superseded by `/api/embed`, single input, no `dimensions` param):

```
POST http://localhost:11434/api/embeddings
{ "model": "all-minilm", "prompt": "dimension probe" }
```

```json
{ "embedding": [0.567, 0.009, ...] }
```

dims = `response.embedding.length`. Prefer `/api/embed`; fall back to `/api/embeddings` only for
very old servers (check `GET /api/version` → `{"version": "0.5.1"}`).

Probe latency on Ollama: if the model isn't loaded, first call includes model load
(`load_duration` — can be seconds for multi-GB models); warm calls are milliseconds. Pass
`keep_alive` if you want it to stay warm; expect the test-connection call to potentially take
several seconds on first use.

## 3. Gotchas

- **Matryoshka / `dimensions` param**: `text-embedding-3-small` (default 1536) and
  `text-embedding-3-large` (default 3072) accept an OpenAI `dimensions` param that truncates
  output. Gemini embedding models (3072, matryoshka) and voyage-4 (2048/1024/512/256) likewise.
  **A probe without `dimensions` returns the DEFAULT (full) dims.** Since our pipeline will
  never send `dimensions` (we want exactly 2048), probe without the param and require
  `len == 2048`. Ollama's `/api/embed` has its own `dimensions` param — same rule: omit it.
  Watch out: matryoshka means a model whose default is 3072 *could* produce 2048 if asked, but
  we intentionally treat default-dims ≠ 2048 as a reject.
- **2048-dim models that DO pass**: `qwen/qwen3-embedding-8b` (4096? verify per model),
  `google/gemini-embedding-001` (3072), `mistralai/codestral-embed-2505` (1536)... — in other
  words, most popular hosted embedding models are NOT 2048; expect many rejects. Known 2048
  defaults: voyage-4 / voyage-4-large (2048), perplexity pplx-embed-v1-4b (2560?), qwen3
  variants vary. The probe is the only safe arbiter — don't hardcode a lookup table.
- **Empty/whitespace input**: some providers (and OpenRouter's moderation layer) can 400 on
  empty-string input. Always probe with a short non-empty string like `"dimension probe"`.
  `is_moderated: true` on some OpenRouter endpoints adds another rejection surface.
- **OpenRouter provider routing**: one model id can be served by multiple upstreams (verified:
  `openai/text-embedding-3-small` is served by both `OpenAI` and `Azure` endpoints). Dims are a
  property of the model so they should match across providers, but the probe measures whichever
  provider OpenRouter routes to at that moment. Pin with `"provider": {"order": [...]}` if
  consistency matters; at minimum accept that a pass now + a routing change later is
  theoretically possible, so re-validating dims on embedding write errors is a good backstop.
- **Model id variants on OpenRouter**: `:free` and `:batch` suffixes (e.g.
  `text-embedding-3-small:batch`) are distinct ids with different pricing/routing — validate the
  exact id the user entered.
- **Ollama `embedding_length` is hidden width**: chat models also expose
  `llama.embedding_length: 4096` etc. Don't trust it blindly for embedding output of
  non-embedding models; use `capabilities` containing `"embedding"` as a gate, then probe.
- **Ollama first-call latency**: cold model load can take seconds — the test-connection
  endpoint needs a generous timeout (≥30s) for Ollama probes.
- **Don't parse `description` text** for dims on OpenRouter (voyage models mention dims in
  prose; most others don't) — it's unversioned marketing copy.

## 4. Recommendation

**Probe-always at save time, for both providers, with one tiny non-empty input and no
`dimensions` param; accept iff the returned vector length is exactly 2048.** Rationale:
OpenRouter exposes no dims metadata at all, so a probe is unavoidable there; Ollama's
`/api/show` → `model_info["*.embedding_length"]` is only a heuristic (hidden width, matryoshka,
projection heads), and probe cost is ~1 token remote / milliseconds-to-seconds local. Using the
same "measure what the pipeline will actually store" code path for both providers keeps the
test-connection endpoint honest and uniform. Cheap hardening on top: (a) for Ollama, pre-flight
with `/api/show` and reject early if `capabilities` lacks `"embedding"`; (b) for OpenRouter,
pre-flight with `GET /api/v1/models?output_modalities=embeddings` membership to give a nicer
"not an embedding model" error than a raw 404; (c) cache the validated dims per (provider,
model id) so re-saves are instant; (d) generous timeout for Ollama cold model loads; (e) treat
embedding-write dimension mismatches at ingest time as a signal to re-validate, covering
silent provider-side changes.
