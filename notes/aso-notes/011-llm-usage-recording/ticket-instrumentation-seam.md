---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Instrumentation seam

## Resolution (2026-08-06)

**Seam shape: TracedProvider decorator at the registry.** `resolveLLMProvider`/`resolveEmbeddingProvider` gain an optional `trace: { workspaceId, traceId, useCase }` option; the returned provider is wrapped in `TracedLLMProvider`/`TracedEmbeddingProvider` which records every call. ~4 call sites (extraction stage, agent loop, consolidation judge, embed stages) pass their trace id explicitly. Rejected: AsyncLocalStorage (invisible context, manual BullMQ setup, undebuggable), per-provider instrumentation (duplicated in every provider class).

**Write strategy: fire-and-forget.** `recordGeneration` writes on its own connection with immediate commit, wrapped in try/catch-and-log — a tracing failure never blocks or fails the LLM call. Failed runs keep their traces (the primary debugging case). Rejected: transactional (rollback erases the failure trace you wanted), BullMQ queue (tracing dies when Redis dies).

**Embeddings: traced as Generations, metadata only.** `llm_use_case='embedding'`, tokens/cost/latency recorded; input text NOT stored (chunks already live in the DB — pure duplication).

**Streaming: accumulate chunks server-side at the seam, record one Generation on stream completion.** Abort/error records the partial response with the error.

**Missing usage: null + flag.** Providers that omit token counts (some streaming modes) → tokens and cost null with a flag on the record; cost UI treats null as unknown, never zero. No tokenizer/heuristic estimation.

## Question

How does the AI registry record Generations without breaking the calls it wraps?

Decisions to pin down:

1. **Write strategy**: fire-and-forget (never block the LLM call; risk losing records on crash) vs transactional with the operation (extraction already writes inside pipeline transactions) vs queued (BullMQ — adds Redis dependency to tracing)?
2. **Failure isolation**: a tracing write failure must never fail the LLM call — try/catch-and-log at the seam? What gets logged where?
3. **Where exactly the seam sits**: inside each provider implementation vs a wrapper around `LLMProvider.complete()` in the registry — one wrapper covers all use cases, but who supplies the trace context (workspace, trace id, use case) at call time? Async-local storage vs explicit parameter threading through extraction/consolidation/agent code?
4. **Streaming**: agent chat streams responses — how is the full response captured (accumulate chunks server-side, record on completion)?
5. **Token counts**: provider returns usage; if a provider omits it (some streaming modes), estimate or leave null?

## Context

- Choke point decided: `server/lib/ai/registry.ts` wraps all four LLM Use Cases.
- Production best practice (research-llm-observability.md): one instrumentation point, structured records, cost at request time.
- Blocked by data model: the schema the seam writes to is decided there.
