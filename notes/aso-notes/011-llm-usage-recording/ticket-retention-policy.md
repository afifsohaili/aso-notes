---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Retention policy

## Resolution (2026-08-06)

**Tiers: content retention configurable via workspace setting `observability.content_retention_days`, default 365.** Past the window, prompt/response/output columns are NULLed and `pruned_at` stamped. **Metadata — model, provider, use case, token counts, cost_usd, latency, status, timestamps — is kept forever** (cost history never degrades). Pruning is explicitly NOT about space (trivial at personal scale) — it's data hygiene: bounding how long stale content copies of edited/deleted notes linger.

**Mechanism: dedicated BullMQ repeatable job (daily)**, separate from consolidation, own disable guard. It NULLs content + stamps `pruned_at` on rows older than the window. **No row deletion ever** — traces and their metadata are immortal.

**Owner deletion: keep metadata, null content immediately** (user revision). Traces have no FK (polymorphic owner), so delete call sites for notes/conversations/consolidation runs must explicitly null the content of their traces (a shared `purgeTraceContentForOwner(db, ownerType, ownerId)` helper). Rationale: intentional deletion should remove content copies; but cost/token metadata survives so cost rollups and audit never get holes. Note a wrinkle: synced-folder removal wipes notes via cascade inside the DB — the purge helper must be invoked at those call sites too, or enforced by the same daily job sweeping traces whose owner no longer exists (decide at implementation; the daily orphan-sweep is the safer catch-all).

**Cap: none.** Purely time-based; no hard row cap (metadata rows are small and forever by design).

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
