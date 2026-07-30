---
type: wayfinder:grilling
status: closed
claimed:
blocked-by: []
---

# Smoke-test note flow

## Question

Pin down the mechanics of the mandatory end-to-end proof (locked: setup cannot complete until a test note written by the app into a synced folder reaches `status='ingested'`, then auto-deletes via the normal unlink flow).

Sub-questions to resolve:

- Test note content and filename (canned, recognizable, e.g. `__aso-notes-smoke-test.md`; folder-cover-style reserved name or plain note?).
- Write mechanism: server writes the file directly into the synced folder (fs), then waits on watcher → sweeper → queue → ingestion. Timeout and failure states: how long do we wait, what does the user see on LLM failure / queue stall (last_run observability exists — surface it)?
- No-Redis hard-block state: exact wizard behavior and copy direction when `NUXT_REDIS_URL` is unset (decided: hard block, surfaced clearly).
- Progress UI: poll which endpoint (`/api/ingestion/status`? note status?) and at what cadence.
- Delete verification: after success the app deletes the file; do we confirm the unlink flowed through (note row gone) before flipping `onboarding.completed_at`?
- Re-run semantics: user re-enters wizard mode (settings) later — can they re-run the smoke test (e.g. after changing providers)?

Context: `apps/web/server/plugins/notes-sync.ts`, `server/lib/sync/{watcher,sweeper,dispatcher,ingest}.ts`, plan-004 status endpoints (`/api/ingestion/status`, `/api/notes/status-counts`), plan-004 `last_run` panel.

Resolution feeds: Author plan-007.

## Resolution (closed 2026-07-31)

Locked defaults and implementation choices:

- **Filename:** `__aso-smoke-test.md` at the root of the workspace's first synced folder (first-created `synced_folders` row ordered by `created_at`).
- **Content:** canned minimal markdown — one heading + one sentence + a second explanatory line, no wikilinks.
- **Endpoints:** `POST /api/onboarding/smoke-test` starts the flow, `GET /api/onboarding/smoke-test?attemptId=...` returns the current phase.
- **State model:** server-side in-memory attempt keyed by workspace, with DB-derived phase. Phases: `written` → `pending` → `queued` → `processing` → `ingested` → `deleting` → `done` / `failed`.
- **Delete semantics:** the first `GET` that sees `status='ingested'` deletes the file, then waits for the normal unlink flow to remove the note row before setting `onboarding.completed_at`.
- **Redis hard-block:** endpoint returns 409 `redis_required` when `NUXT_REDIS_URL` is unset; UI disables the verify step and shows the existing Redis warning.
- **No synced folder:** endpoint returns 409 `no_synced_folder`.
- **Stale attempt:** endpoint returns 409 `stale_attempt` for mismatched `attemptId`.
- **Timeout:** 3 minutes; failed state surfaces guidance copy and `last_run` detail.
- **Retry:** a fresh POST deletes any stale file/note row and starts a new attempt. Re-verify in steady-state does **not** clear `onboarding.completed_at`.

This ticket feeds into [plan-007-onboarding.md](plan-007-onboarding.md) Phase 5.

## One-line gist

Smoke test: write `__aso-smoke-test.md` to the first synced folder, poll until ingested, then delete it and wait for the unlink row to vanish before flipping `onboarding.completed_at`; Redis/folder prerequisites are 409 hard-blocks. → [plan-007-onboarding.md](plan-007-onboarding.md) Phase 5.
