---
type: wayfinder:task
claimed:
blocked-by: [ticket-synced-folder-data-model.md, ticket-wizard-mode-ux-options.md, ticket-smoke-test-note-flow.md, ticket-embedding-dims-detection.md, ticket-orphan-gc-rules.md]
---

# Author plan-007

## Question

Assemble the final spec: restructure `plan-007-onboarding.md` from wayfinder map into the same plan format as plans 003/004 — problem, locked decisions, data model changes, parts-changing per area, build order (milestones), deferred/open section.

Must incorporate:

- All pre-ticket locked decisions (map's Decisions-so-far).
- Resolutions of every blocking ticket (linked from this map's index).
- CONTEXT.md glossary updates: add **Synced Folder** and **Onboarding** (and any terms the tickets coin).
- Data model: `synced_folders` table, notes/FK shape per data-model ticket, new `workspace_settings` keys (`llm.agent.provider/model`, `llm.extraction.provider/model`, `llm.embedding.provider/model`, `onboarding.completed_at`).
- Parts changing: boilerplate deletion (landing + admin/articles/todos/dashboard), entry redirects, settings-as-wizard page, gate middleware, sync plugin multi-root + in-process reload, LLM registry resolution chain + singleton invalidation, test-connection endpoint, smoke-test flow, orphan GC, danger-zone interplay.
- Build order sized to TDD milestones with verification commands (repo convention: `pnpm --filter web vitest run ...`, full suite green per milestone).
- Fog that resolved during ticketing gets folded in; anything still foggy stays in Deferred/open honestly.

Done when: the spec is unambiguous enough to hand to an implementation session without further questions.
