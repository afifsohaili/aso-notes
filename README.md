# aso-notes — Personal Knowledge Assistant

An agentic graph-RAG system over your personal notes.

Notes are ingested from synced folders, a graph of Concepts and Relations is derived from them, and an Agent answers your Queries using retrieval Tools — returning an Answer plus the Notes that informed it.

Inspired by LightRAG, but retrieval is driven by an Agent with Tools rather than a fixed pipeline.

## How it works

- **Note-first.** Every Note is a file (Markdown primary) living inside a Folder. Notes can reference Sources (external material) and Link to other Notes.
- **Sync.** Notes are ingested from a synced local folder, watched for changes with a 5-minute debounce plus a manual "Sync now". Renames are detected via content hash.
- **Derived graph.** The system extracts Concepts, Relations, and Mentions from Notes into a read-only graph. You influence it via Links and Tags, not manual editing.
- **Agentic retrieval.** Ask a Query in a Conversation; the Agent uses Tools (`search_notes`, `search_concepts`, `get_concept_neighbors`, `get_mentions`, `read_note`, `find_paths_between`, `search_sources`) to gather Context and generate an Answer with source Notes.

## Tech stack

- **Frontend**: Nuxt 3, Vue 3 Composition API, Tailwind CSS, TypeScript
- **Backend**: Nitro (Nuxt server), Kysely, PostgreSQL
- **Auth**: BetterAuth (email/password with verification)
- **Storage**: `pgvector` for Embeddings, Apache AGE for graph storage and traversal (Cypher)
- **AI**: OpenRouter — LLM `deepseek/deepseek-v4-flash`, Embeddings `nvidia/llama-nemotron-embed-vl-1b-v2:free`, behind a strategy pattern for swappable providers
- **Testing**: Vitest (in-process transactional e2e via `@base/testing`)

## Repository layout

```
apps/web/         Nuxt application (frontend + Nitro server, migrations, tests)
packages/
  components/     Shared UI components
  jobs/           Background job / queue system (Sync, Ingestion)
  shared/         Shared utilities and types
  testing/        Test foundation (@base/testing) — see packages/testing/README.md
docker/postgres/  PostgreSQL with pgvector + Apache AGE
skills/           Project skills (e.g. write-e2e-test)
plans/            Architecture and implementation plans
product.md        Product specification and decisions
CONTEXT.md        Canonical glossary (ubiquitous language)
```

## Setup

```bash
pnpm install
docker compose up -d    # PostgreSQL with pgvector + Apache AGE
pnpm db:migrate
```

## Development

```bash
pnpm dev                # dev server on http://localhost:3000
pnpm build              # production build
pnpm preview            # preview production build
pnpm lint               # lint (pnpm lint:fix to autofix)
```

## Testing

```bash
pnpm test                       # full suite
pnpm test:e2e                   # fast in-process transactional e2e project
pnpm test:components            # component tests
pnpm test:watch                 # watch mode
```

Built-server tests (real HTTP/WebSocket) live in `apps/web/test/e2e-built/`.
See `packages/testing/README.md` and `skills/write-e2e-test/SKILL.md` for templates and rules.

## Database

```bash
pnpm db:migrate                 # run migrations
pnpm db:migrate:generate        # migrate + regenerate Kysely types
```

## Domain language

All code, database, and UI terms follow the canonical glossary in `CONTEXT.md` — Workspace (not organization), Note (not document), Concept (not entity/node), etc. Update `CONTEXT.md` when terminology changes.
