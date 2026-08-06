---
label: wayfinder:prototype
blocked-by: [ticket-agent-chat-tracing]
---

# Ticket: Trace UI in /chat

## Question

What does inspecting a Trace from /chat look like?

Elements to arrange:

- Entry point: a "trace" affordance on each Answer message
- Trace view: the agent loop as a timeline/tree — Generations (prompt/response expandable, model, tokens, cost, latency), Tool Calls (name, args, output), final Answer
- Where it lives: side panel in /chat vs dedicated route (/chat/[id]/trace)?
- Density: full prompts inline vs collapsed-by-default?

HITL prototype ticket: rough variants with mock trace data, `?variant=` switcher, same approach as the settings-tabs and consolidation-page prototypes.

## Context

- This is the primary "how did the agent arrive at this result" debugging surface (the map's core use case).
- Blocked by agent chat tracing: what's recorded shapes what's renderable.
