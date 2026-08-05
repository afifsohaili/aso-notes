---
label: wayfinder:grilling
blocked-by: []
claimed-by: afif
status: closed
---

# Ticket: Consolidation observability

## Resolution (2026-08-05)

**Change record: written at execution time.** Each merge/prune/rewrite/dissolve writes a human-readable line as it happens (action, entity names, LLM judge's reason) — one row per action, keyed to its run. Snapshots stay purely for restore; no snapshot diffing anywhere (IDs not names, noisy, breaks with retention).

**Surface: the Consolidation page** (Settings → Extraction → Consolidation, per the settings-tabs decision). Run history list: mode, when, status, change counts, LLM usage. Run detail: the change lines.

**Restore UX: per-run "Restore to before this run" button** + confirm dialog spelling out: graph reverts, Notes ingested since re-extract (LLM spend), one-way door. **No pre-restore snapshot** — user accepted the one-way property (within retained history). A UI prototype of this page was requested: see the Consolidation page UI prototype ticket.

**Failure visibility: run history + nav badge.** Failed runs show red with the error; a badge on the Settings nav flags the most recent failure until viewed. No email.

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
