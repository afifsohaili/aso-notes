---
label: wayfinder:grilling
blocked-by: [ticket-trace-data-model]
---

# Ticket: Retention policy

## Question

How long are Traces kept, and does content (prompts/responses) age out before metadata?

Decisions to pin down:

1. **Tiers**: full content hot for N days, metadata (tokens/cost/model/latency) kept longer/forever? Prompts contain personal notes content — the storage cost is trivial at personal scale, but stale prompt copies of deleted notes are a data-hygiene question.
2. **Pruning mechanism**: extend the existing consolidation cron pattern (BullMQ repeatable job) or piggyback snapshot retention? Null-out content columns vs delete rows (feeds the data model's nullable-content decision)?
3. **Cascade behavior**: what happens to traces when a note/conversation/consolidation run is deleted — cascade, set-null, or keep (audit trail argues keep; data hygiene argues cascade)?
4. **Cap**: a hard row cap per workspace (like snapshot retention's 10) or purely time-based?

## Context

- Production practice (research-llm-observability.md): retention tiers — full traces hot briefly, metadata longer.
- Audit-trail use case (user's brief) argues for keeping metadata indefinitely.
- Blocked by data model: column nullability strategy decided there.
