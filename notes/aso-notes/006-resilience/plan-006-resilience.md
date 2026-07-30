# Plan 006: AI Provider Resilience

> Status: **Phase 1 done, Phase 2 done** — Phase 3 pending.

## Problem

All four AI providers (`OpenRouterLLMProvider`, `OpenRouterEmbeddingProvider`,
`OllamaLLMProvider`, `OllamaEmbeddingProvider`) call raw `fetch` with **no
timeout, no retry, no backoff, no error classification**. Consequences:

- One 429 / 5xx / network hiccup during Ingestion → Note flips to `failed`,
  BullMQ retries the whole pipeline 3× within ~15s, then permanently `failed`.
- A hung socket keeps a BullMQ job `active` forever (worker auto-renews the
  lock) → Note stuck in `processing` forever.
- OpenRouter platform 429s carry `X-RateLimit-*` / `Retry-After` headers we
  throw away; 402 (out of credits) is non-retryable but indistinguishable
  from a transient 500 today.
- The default embedding model is a `:free` variant → platform caps of
  20 req/min, 50 req/day. Bulk Ingestion will 429 constantly without pacing.

## Decisions (from grilling session 2026-07-30)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Retry layer | **Both** — provider-level wrapper inside the job + BullMQ outer net |
| 2 | Error policy | Classify: retry 429/5xx/network/timeout, honor `Retry-After`, fail fast on 400/401/402/404 |
| 3 | OpenRouter routing | None — no `models[]` fallback, keep `:free` variants |
| 4 | Queue pacing | BullMQ worker `limiter` (~18/min, under free-tier 20 RPM) + BullMQ `RateLimitError` pause on exhausted 429 |
| 5 | Agent chat loop | Out of scope — inherits the provider wrapper transparently, no `loop.ts` changes |
| 6 | Stage checkpointing | Skip — full pipeline restart on exhaustion is acceptable |

## Design

### New: `apps/web/server/lib/ai/resilient-fetch.ts`

Shared fetch wrapper used by all providers:

- Typed errors:
  - `RateLimitError` (429; carries `retryAfterMs: number | null` parsed from
    the `Retry-After` header)
  - `TransientError` (5xx, network failure, timeout)
  - `FatalError` (400/401/402/404 — never retried)
- `AbortSignal.timeout(timeoutMs)` per attempt — kills hung sockets.
- Exponential backoff + jitter between attempts; `Retry-After` header takes
  precedence over computed backoff for 429s.
- Options: `{ timeoutMs, maxAttempts, baseDelayMs, fetchFn? }` (fetchFn
  injectable for tests, matching existing provider convention).

### Modified providers (Phase 2)

- `openrouter-llm.ts`, `openrouter-embedding.ts`, `ollama.ts` — swap raw
  `fetch` for `resilientFetch`; remove their inline `!response.ok` throw
  blocks. Tunables passed via constructor options with per-use-case defaults
  (extraction/embedding: ~60s timeout, 4 attempts; agent chat: same for now).
- Pipeline stages (`extract-graph.ts`, `embed-chunks.ts`) and agent
  `loop.ts` unchanged — resilience is transparent.

### BullMQ outer net (Phase 3)

- `server/utils/worker.ts` / `ingestion-worker.ts`: add `limiter:
  { max: 18, duration: 60_000 }` to stay under the free-tier 20 RPM cap.
- `ingestion-worker.ts` processor: when `ingestNote` throws our
  `RateLimitError` (i.e. provider-level retries exhausted on 429), throw
  BullMQ's `RateLimitError` instead → the whole queue pauses for the limiter
  duration rather than burning job attempts.
- `ingest.ts`: when the run failed with `RateLimitError`, do **not** flip the
  Note to `failed` (it's a pause, not a failure) — leave status at
  `processing`/`queued` so the sweeper/BullMQ can resume it. `last_run` still
  records the rate-limited attempt.
- Queue default job options: keep `attempts: 3` but lengthen backoff
  (minutes-scale, e.g. base 30s exponential) since provider-level retry
  handles the seconds-scale transient window.

### Effective retry budget after this lands

Per job attempt: ~4 provider-level tries (with Retry-After honored) →
3 BullMQ attempts with minutes-scale backoff → ~12 total LLM call tries
before a Note can fail, plus the 18/min limiter preventing most 429s.

## Phases

1. **Phase 1 — resilient fetch core**: errors + wrapper + unit tests
   (classification, Retry-After parsing, timeout, backoff/jitter, exhaustion).
   Commit. **Status: done.**
2. **Phase 2 — wire providers**: all 4 providers use `resilientFetch`;
   registry passes per-use-case options; provider unit tests updated/added
   (mocked `fetchFn`: 429-then-success, fatal passthrough, timeout).
   Commit. **Status: done.**
3. **Phase 3 — BullMQ pacing**: worker limiter, `RateLimitError` pause
   translation, `ingest.ts` rate-limit status handling, longer job backoff.
   Feature specs (in-process e2e via `@base/testing`: enqueue → rate-limited
   provider → note NOT failed, job paused; recovered → ingested). Commit.
4. **Phase 4 — close-out**: full test suite green, update this doc's status,
   record divergences. Commit.

## Test strategy

- TDD red-green-refactor throughout.
- Unit tests for `resilient-fetch.ts` edge cases (injected `fetchFn` +
  fake timers where feasible).
- Feature specs hit real API endpoints / worker handlers in-process via
  `@base/testing` (transactional DB, `queue` fixture in `fake`/`inline`
  mode) and verify DB records + response bodies.
- No live API calls in tests.

## Out of scope

- Agent loop retry UX (`agent/loop.ts`) — decision 5.
- OpenRouter `models[]` server-side fallback, dropping `:free` variants —
  decision 3.
- Pipeline stage checkpointing — decision 6.
- The zombie-`jobId` dedupe bug (failed BullMQ jobs block re-dispatch for 7
  days) — separate issue, tracked independently.

## Divergences from plan

- `sleepFn` is exposed as an injectable option in addition to `fetchFn`; the injected value receives the already-jittered delay (the final wait time), not the raw exponential backoff. This lets unit tests assert jitter bounds without mocking a random source.
- Per-attempt `AbortSignal.timeout` is composed with any caller-supplied `init.signal` via `AbortSignal.any`. A caller abort is therefore treated as a transient error and retried, matching the timeout/network path; this was chosen as the "simplest correct approach" and is documented in the code.
- The `nuxt typecheck` command referenced in AGENTS.md is not available as a package script; `tsc --noEmit` was used instead. It surfaces numerous pre-existing type errors but none in the new files.
- `RateLimitError` now carries an optional `context` field populated from `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers when present, in addition to the parsed `Retry-After` value. This makes the OpenRouter platform context trivially available to callers.
- Providers expose a `public readonly resilience` object (timeoutMs / maxAttempts / baseDelayMs) so the registry and tests can observe the resolved configuration without reaching into internals.
- Per-use-case resilience values are configured via `NUXT_LLM_<ROLE>_{TIMEOUT_MS,MAX_ATTEMPTS,BASE_DELAY_MS}` environment variables. The registry already consumed `process.env` as an `EnvMap`, so runtime config is threaded through env vars rather than the `useRuntimeConfig()` object.
- `sleepFn` is also accepted as a constructor option by each provider so provider-level unit tests can stub retries without real timers.
