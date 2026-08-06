---
label: wayfinder:grilling
blocked-by: [ticket-trace-data-model, ticket-instrumentation-seam]
---

# Ticket: Agent chat tracing

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
