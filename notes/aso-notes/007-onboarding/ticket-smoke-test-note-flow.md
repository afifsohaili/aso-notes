---
type: wayfinder:grilling
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
