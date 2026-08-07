---
label: wayfinder:map
---

# Wayfinder Map: LLM Usage Recording & Tracing

## Destination

A full LLM observability/tracing system built in-repo: every Generation and Tool Call recorded with prompt, response, model, tokens, latency, cost, correlated by Trace across Ingestion Runs, Consolidation Runs, and /chat Conversations. Cost tracking falls out of the trace data; /chat debugging gets real traces. Map is done when no decision remains before implementation.

## Notes

Domain: agentic graph-RAG over personal notes. Canonical terms: notes/aso-notes/CONTEXT.md. Research basis: research-llm-observability.md in this folder (tooling landscape, OTel GenAI + OpenInference conventions, production best practices).

Skills to consult: /grilling, /domain-modeling, /prototype (UI tickets).

### Decisions locked in pre-map grilling (2026-08-06)

- **Destination scope: full observability/tracing**, not a thin usage ledger. Rejected: ledger-only, ledger-now-traces-later.
- **Build in-repo.** Rejected: self-hosted Langfuse (4-service infra — Postgres+ClickHouse+Redis+blob — disproportionate for a personal app), Helicone proxy, LangSmith hosted. Borrow Langfuse's data model (Trace + child observations) and OTel GenAI/OpenInference vocabulary.
- **Placement: app code** (`apps/web/server/lib/observability/` + app migrations + app API/UI), NOT a monorepo package. Trace rows carry workspace FKs and domain links; packages/shared types are generated from app migrations — a package would invert the dependency direction. Existing packages are infra-generic; tracing is not.
- **Glossary (adopt into CONTEXT.md, standard-aligned): Trace** (end-to-end record of one Ingestion Run / Answer / Consolidation Run), **Generation** (a single model request/response — Langfuse's term; avoid: inference, span, LLM call), **Tool Call** (one Tool invocation inside a Trace), **LLM Use Case** (the provider config slot: agent/extraction/embedding/consolidation).
- **Verification scope: manual inspection via traces only.** Rejected: anomaly signals, eval harness (per pre-map grilling).
- **Instrumentation at the AI registry choke point** (`server/lib/ai/registry.ts`) — one seam covers all LLM Use Cases (production best practice).
- **Cost computed at request time** — tokens × model rate at that moment, never backfilled (production best practice).

- [Trace data model](ticket-trace-data-model.md) — 3 tables: `llm_traces` (polymorphic owner_type+owner_id storing exact table names, no FK), `llm_generations` (inline JSONB prompt/response, cost_usd numeric(12,6)), `llm_tool_calls` (own table, ~8KB truncated output); flat + seq, no nesting; nullable content + pruned_at retention hooks.
- [Instrumentation seam](ticket-instrumentation-seam.md) — TracedProvider decorator at the registry choke point with explicit trace option (~4 call sites); fire-and-forget writes; embeddings metadata-only; streaming accumulates to one Generation; missing usage = null + flag.
- [Agent chat tracing](ticket-agent-chat-tracing.md) — one Trace per Answer; `messages.trace_id` amendment; disconnect = partial record + aborted flag; Context re-derivable from Tool Call outputs.
- [Cost model](ticket-cost-model.md) — cost = OpenRouter `usage.cost` passthrough at request time (returned on every response incl. streaming, no params needed); Ollama = 0; missing cost = null + flag, never estimated; no pricing table; rollups computed on read.
- [Pipeline tracing](ticket-pipeline-tracing.md) — extractionRecord becomes pointer (last_run metadata + trace_id; payload only in llm_generations); one Trace per Ingestion Run (extraction + metadata-only embedding Generations) and per Consolidation Run (judge Generations; usage = rollup on read — closes the Phase 8/9 gap).
- [Instrumentation seam](ticket-instrumentation-seam.md) — TracedProvider decorator at registry with explicit `trace` option (~4 call sites); fire-and-forget writes (try/catch-log); embeddings traced metadata-only; streaming accumulates → one record; missing usage = null + flag.
- [Agent chat tracing](ticket-agent-chat-tracing.md) — one Trace per Answer (owner = conversation; per-answer cost/debug/retention trivial); `messages.trace_id` links answer → trace (data-model amendment); disconnect = partial record + aborted flag; Context re-derivable from Tool Calls, nothing extra stored.
- [Cost model](ticket-cost-model.md) — OpenRouter `usage.cost` passthrough (verified: returned automatically in every response incl. streaming); Ollama = 0; custom providers missing cost = null + flag; no pricing table — pricing-drift fog dissolved.

## Not yet specified

- **OTel export**: whether traces should ever be exportable to a standard backend (OTLP). Sharpens once the data model exists — if the model mirrors OTel GenAI attributes, export is cheap later.
- **Multi-user PII**: single-user app today; redaction/retention rules if that changes.

## Out of scope

- Eval harness / scored test sets — rejected in grilling (manual inspection via traces only).
- Automated anomaly signals (token spikes, tool-call loops) — rejected in grilling.
- Self-hosted Langfuse / Helicone / LangSmith adoption — rejected; build in-repo.
- Monorepo package extraction — rejected; app code.
- Backfilling historical cost — no historical data exists; request-time recording only.
