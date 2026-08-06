# Research: LLM observability tooling & production practices

Researched 2026-08-06 via web search. Feeds the build-vs-adopt decision for the LLM usage/tracing map.

## The tooling landscape (4 architectural approaches)

| Tool | Architecture | Strengths | Tradeoffs |
|---|---|---|---|
| **Langfuse** | Full platform, open-source, self-hostable | Traces, prompt management, datasets, evals, dashboards | Self-host v3 needs Postgres + ClickHouse + Redis + blob storage — heavy infra for a personal project |
| **LangSmith** | Hosted SaaS | Deep agent tracing + evals | LangChain/LangGraph ecosystem; hosted = prompts leave your infra |
| **Helicone** | Gateway/proxy | Instant setup, cost tracking, provider routing | All LLM traffic flows through their proxy; architecture may not fit |
| **OpenLLMetry (Traceloop)** | Instrumentation libraries on OpenTelemetry | Vendor-neutral, standard-compliant | Instrumentation only — you still need a backend to store/view |

Market note: LLM observability ~$2.69B in 2026. All four center on the same primitives: traces → spans → token/cost/latency attributes.

## The emerging standard: OpenTelemetry GenAI semantic conventions

CNCF-graduated standard (repo: open-telemetry/semantic-conventions-genai). Even if we build in-repo, **mirroring this vocabulary keeps us compatible with the ecosystem**:

- **Span types**: `inference` (model call), `execute_tool` (tool invocation), `embeddings`, `retrieval`. Span name convention: `{gen_ai.operation.name} {gen_ai.request.model}`.
- **Key attributes**: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.conversation.id` (correlates a whole session/thread), `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `error.type`, prompt template name/version.
- **Content capture**: three sanctioned patterns — (a) full buffered content on attributes, (b) events alongside the span, (c) upload to external storage with a reference. Streaming handled via chunked events.
- **Trace context**: W3C `trace_id`/`span_id` so multi-step runs (agent loops, ingestion pipelines) correlate across spans.

## Production best practices (from teams at scale)

1. **Structured JSON records, never free text** — every field named/typed/queryable. Canonical record: request_id, timestamp, model, prompt/completion tokens, latency_ms, cost_usd, trace_id, span_id.
2. **Cost computed at request time** — tokens × the model's published rate *at that moment*, written into the record; never backfilled by a nightly job.
3. **One instrumentation choke point** — a proxy or shared SDK wrapper in front of every provider, not N call sites. (Our AI registry is exactly this seam.)
4. **PII redaction before the write** — hashed identifiers instead of raw user IDs; retention tiers. GDPR data-minimisation makes raw prompt dumps a liability. (For a single-user personal app the calculus differs, but the principle stands.)
5. **Retention tiers + sampling at volume** — full content is expensive (60GB/month at 1M req/day); keep full traces hot briefly, metadata longer.
6. **Trace the retrieval and tool steps, not just the final model call** — agent debugging needs the full path: prompt → retrieved context → tool calls → answer.
7. **Record prompt template name + version** — so behavior changes can be tied to prompt changes.
8. **Evals make traces actionable, but start small** — golden set of real questions, score retrieval and answer separately. (We scoped this out: manual inspection only.)

## Relevance to aso-notes

- Our `server/lib/ai/registry.ts` per-use-case provider config is a natural single choke point — instrument once, cover agent/extraction/consolidation/embedding.
- `extractionRecord` (per-note latest extraction with messages/response/usage) is a precedent for in-repo trace storage — but latest-only, no history.
- Self-hosted Langfuse's 4-service infra is disproportionate for a personal app; its *data model* (traces/spans/generations) is worth borrowing.
- OTel GenAI attribute names give us a ready-made column/field vocabulary for the in-repo tables.

## Sources

- github.com/open-telemetry/semantic-conventions-genai (gen-ai-spans.md)
- techsy.io/en/blog/llm-logging-best-practices (9 production rules)
- zglg.work/en/ai/guides/llm-observability-tools (tool comparison)
- braintrust.dev/articles/best-tools-tracking-llm-costs-2026
