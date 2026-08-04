---
label: wayfinder:grilling
blocked-by: [ticket-snapshot-restore-mechanics]
---

# Ticket: Consolidation observability

## Question

How does the User see what the Consolidation cron did?

Decisions to pin down:

1. **Run history surface:** a list of past runs (when, mode, what changed) on the Settings Consolidation tab — what granularity (counts vs named merges/prunes)?
2. **Snapshot diffing:** can the User inspect "what changed in run N" — derived from diffing snapshots, or does the run need to record a human-readable change summary at execution time?
3. **Restore UX:** where does "restore to before run N" live, what does it warn (Notes ingested since will re-extract, LLM spend), confirm flow?
4. **Failure visibility:** what happens when a run fails midway — how does the User find out (email worker exists; in-app badge?)?

## Context

- Blocked by Settings tabs (where this UI lives) and snapshot mechanics (what data exists to show).
- Pre-map decision: fully automatic cron, so this surface is the User's only window into it.
