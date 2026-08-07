---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Agent chat tracing

## Resolution (2026-08-06)

**Trace boundary: one Trace per Answer** (user message → final answer), kind=`chat`, owner = the `conversations` row. User first picked per-Conversation, then reversed after seeing the tradeoffs (per-answer cost/debugging/retention trivial vs growing unbounded trace needing message attribution). The conversation-level journey view is a query (`WHERE owner_type='conversations' AND owner_id=?`), not a storage shape.

**Schema amendment to the data-model ticket: `messages.trace_id` nullable column** — the assistant Answer message points at its Trace. This is the /chat UI's "view trace" link per answer. No message_id on generations/tool_calls needed.

**Tool Calls: as decided in the data-model ticket** — own table, full input args JSONB, output truncated ~8KB, seq ordering, duration_ms. Nothing chat-specific.

**Streaming & disconnect: the seam accumulates chunks; on client disconnect mid-stream the Generation records the partial text with an aborted flag (+ error if any).** A partial record beats a missing one — a disconnected answer is often the one you're debugging.

**Context: nothing extra stored.** The assembled Context is exactly the union of Tool Call outputs, already recorded; re-deriving from them is trivial. No separate context snapshot.

## Question

How is a /chat Answer traced — every loop iteration, Tool Call, and the streamed response?

Decisions to pin down:

1. **Trace boundaries**: one Trace per Answer (user message → final answer), one per Conversation, or one per loop iteration?
2. **Tool Calls**: the agent's tools (search_notes, get_mentions, find_paths_between, etc.) — record input args + full output (retrieved chunks can be large — truncate?) + duration + ordering?
3. **Streaming**: the answer streams to the client — the Generation record captures the accumulated final text on completion; what happens on client disconnect mid-stream?
4. **Trace surfacing in /chat**: how does the user open "why did the agent say this" — a trace link on each Answer message? What identifier does the client need (trace id on the answer payload)?
5. **Context**: what parts of the assembled Context (notes, concepts, sources) are recorded vs re-derivable from Tool Call records?

## Context

- Verification scope: manual inspection via traces — this ticket IS the primary debugging surface.
- Existing: conversations/messages tables; agent loop in server/lib/agent (loop.ts, tools/).
- Blocked by data model + instrumentation seam.
