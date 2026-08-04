---
label: wayfinder:task
blocked-by: [ticket-snapshot-restore-mechanics]
---

# Ticket: Incremental run bookkeeping

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
