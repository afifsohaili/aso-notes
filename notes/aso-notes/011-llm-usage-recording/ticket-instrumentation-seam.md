---
label: wayfinder:grilling
blocked-by: []
---

# Ticket: Instrumentation seam

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
