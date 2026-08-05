---
label: wayfinder:task
blocked-by: [ticket-snapshot-restore-mechanics]
claimed-by: afif
status: closed
---

# Ticket: Incremental run bookkeeping

## Resolution (2026-08-05)

**High-water mark:** the last *successful* run's `finished_at` (from `consolidation_runs`) vs `created_at` on Concepts/Topics. Both columns already exist; failed runs don't advance the cursor, so a failed run's scope is re-examined next time. First run = full sweep (no prior watermark).

**Neighbor net: top-10 embedding neighbors above cosine 0.75** per new Concept/Topic — those pairs go to the LLM judge. Bounded, predictable LLM spend per incremental run.

**Race policy:** resolved upstream (Merge execution mechanics) — idle-queue gate inside the job, throw + self-reschedule.

**BullMQ wiring:** two repeatable jobs — nightly incremental (~03:00) and weekly full sweep — gated by `NUXT_DISABLE_CONSOLIDATION=1`. The manual "Consolidate now" button enqueues the same job in `full` mode. Run `mode` recorded on `consolidation_runs`: `incremental` | `full` | `manual`.

## Question

How does an incremental Consolidation run know what's "new since the last run," and how does it avoid racing with in-flight Ingestion?

Decisions to pin down:

1. **High-water mark:** `consolidation_runs.finished_at` vs Concepts/Topics `created_at`/`updated_at` — is the existing timestamp data sufficient, or does the run need an explicit cursor?
2. **Neighbor expansion:** incremental covers new rows "plus their near neighbors" — how near (embedding top-k per new Concept? co-Mentioned Concepts?) and how is that bounded?
3. **Race with Ingestion:** a Note mid-pipeline creates Concepts while the cron reads the vocabulary — lock, skip-locked, or accept and let the next run catch stragglers?
4. **BullMQ wiring:** repeatable-job setup for nightly incremental + weekly full, `NUXT_DISABLE_*` gate, and how the manual "Consolidate now" button enqueues the same job.

## Context

- Blocked by snapshot mechanics: needs the `consolidation_runs` table shape decided there.
- Existing worker patterns: `server/plugins/ingestion-worker.ts`, `server/plugins/email-worker.ts`.
- Pre-map decision: nightly incremental + weekly full sweep, first run is a full sweep.
