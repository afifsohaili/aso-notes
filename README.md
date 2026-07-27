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

### Prerequisites

- **Node.js 24** (see `.tool-versions`)
- **pnpm 11** (`corepack enable` if needed)
- **Docker** (PostgreSQL + Redis run as containers; no local installs required)

### 1. Clone and install

```bash
git clone <repo-url> && cd aso-notes
pnpm install
```

### 2. Start infrastructure

```bash
docker compose up -d
# PostgreSQL 16 with pgvector + Apache AGE on port 5433
# Redis (ingestion queue) on port 6379
```

### 3. Configure environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then fill in the values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` / `NUXT_DATABASE_URL` | yes | Postgres connection string — the Docker default works as-is |
| `NUXT_NOTES_DIR` | yes | Absolute path of the local folder to watch for notes (Markdown files) |
| `NUXT_OPENROUTER_API_KEY` | yes | OpenRouter key (https://openrouter.ai/keys) — powers ingestion embeddings and the chat agent |
| `BETTER_AUTH_SECRET` / `NUXT_BETTER_AUTH_SECRET` | yes | Auth session secret — `openssl rand -base64 32` |
| `NUXT_REDIS_URL` | yes | Ingestion queue + sweeper — the Docker default works as-is. Without it, synced notes stay `pending` and are never ingested |
| `NUXT_LLM_AGENT_PROVIDER` / `NUXT_LLM_AGENT_BASE_URL` / `NUXT_LLM_AGENT_MODEL` | no | Chat agent backend: `openrouter` (default) or `ollama`, optional base-URL override, model ID |
| `NUXT_LLM_EXTRACTION_PROVIDER` / `NUXT_LLM_EXTRACTION_BASE_URL` / `NUXT_LLM_EXTRACTION_MODEL` | no | Ingestion extraction backend — same triple, independent of the agent |
| `NUXT_LLM_EMBEDDING_PROVIDER` / `NUXT_LLM_EMBEDDING_BASE_URL` / `NUXT_LLM_EMBEDDING_MODEL` | no | Embedding backend — default OpenRouter `nvidia/llama-nemotron-embed-vl-1b-v2:free`. Local embedding models need a schema migration (2048-dim columns) |
| `NUXT_OPENROUTER_CHAT_MODEL`, `NUXT_OPENROUTER_EMBEDDING_MODEL` | no | Legacy model overrides — still honored as fallbacks |
| `NUXT_EMAIL_PROVIDER`, `NUXT_BREVO_API_KEY`, `NUXT_SENDER_EMAIL`, `NUXT_SENDER_NAME` | no | Transactional email. In dev, email verification is bypassed entirely, so these are unused locally |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY`, `NUXT_TURNSTILE_SECRET_KEY` | no | Signup captcha — skipped entirely in dev (`NODE_ENV=development`) |
| `NUXT_PUBLIC_POSTHOG_API_KEY`, `NUXT_POSTHOG_API_KEY` | no | PostHog analytics |
| `NUXT_PUBLIC_SITE_URL` | no | SEO / sitemap |

### 4. Migrate the database

```bash
pnpm db:migrate
```

### 5. Run

```bash
pnpm dev    # https://asonotes.localhost (via portless)
```

The `dev` script runs through [portless](https://github.com/vercel-labs/portless), so the app is served with trusted HTTPS at `https://asonotes.localhost` instead of a bare port. This requires portless installed globally (`npm install -g portless`; first run trusts a local CA and may ask for sudo). Without portless, use the raw script instead:

```bash
pnpm --filter web dev:app    # http://localhost:3000, no proxy
```

Sign up (email verification and Turnstile are bypassed in dev), then drop Markdown files into `NUXT_NOTES_DIR`. Files are picked up as `pending` and ingested in the background (chunked, embedded, and mined for Concepts/Relations). Ask questions on the **Chat** page, browse files on **Notes**, explore the derived graph on **Graph**.

## Using it yourself

Right now the way to run aso-notes is exactly the flow above: clone the repo, start the Docker services, configure `.env.local`, and `pnpm dev` (or `pnpm build && pnpm preview` for a production-mode build) on your own machine. There is no packaged deployment yet (no app Docker image or hosting config) — that's future work.

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
