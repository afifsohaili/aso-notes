---
label: wayfinder:prototype
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Trace UI in /chat

## Resolution (2026-08-06)

**Answer: dedicated full-page trace view** (own route, e.g. `/chat/[id]/trace`), reached via a **subtle link under each Answer** ("View trace · $0.0351 · 11k tok"). Page header: title, started→finished, status, totals (steps / tokens / cost); centered chronological step timeline below.

**All steps expanded by default** — prompt/response and tool input/output visible without clicking (user iterated: tried a left timeline rail + dots, rejected it; keep plain cards). Cards remain individually collapsible.

Step cards: icon + name (Generation = model, Tool Call = tool name), one-line summary (tokens · cost · latency · finish_reason / duration), indigo for Generations, amber for Tool Calls.

Rejected: side-panel drawer (too cramped for full prompts), inline-in-thread (breaks thread flow).

Prototype captured on branch `proto/chat-trace-ui` (all three variants + shared timeline + mock trace; question: "what does inspecting a Trace from /chat look like?"). Main keeps none of it — reimplement properly with i18n, real data, tests.

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
