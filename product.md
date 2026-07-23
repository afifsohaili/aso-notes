# Product Specification: Agentic Graph-RAG for Personal Notes

## Vision

A personal knowledge assistant that ingests your notes, extracts a graph of concepts and relations, and lets you query it through an agentic RAG interface. The assistant answers your questions and surfaces the notes that informed the answer. The design is inspired by LightRAG, but retrieval is driven by an agent with tools rather than a fixed pipeline.

Notes can be any file, with Markdown as the primary format. The system supports synced local folders, writing notes in the app, and future ingestion of external sources like transcribed videos and Excalidraw files.

## Core Concept

- **Note-first.** Every Note is a file. A Note lives inside a Folder. Notes can reference Sources (external material) and Link to other Notes.
- **Derived graph.** The system reads your Notes and extracts Concepts, Relations, and Mentions. You do not edit the graph manually, but you can influence it by adding Links between Notes or by adding Tags.
- **Agentic retrieval.** When you ask a Query, an Agent uses retrieval Tools to gather Context and generate an Answer. The Answer is returned with a list of Notes.
- **Single-user now, multi-tenant later.** The MVP is for one User, but the data model is designed so a Workspace can eventually be shared or isolated per tenant.

## Guidelines

### Ubiquitous Language in Code and Database

All domain terms in this glossary MUST be used consistently in:

- Database table and column names
- TypeScript types, interfaces, and enums
- API route names and function names
- UI copy and user-facing language
- Documentation and comments

Avoid synonyms in code. If the glossary says **Workspace**, do not use `organization`, `tenant`, or `space` in code. If the glossary says **Concept**, do not use `topic`, `entity`, or `node` in code.

The canonical glossary lives in `CONTEXT.md`. Update it when terminology changes. This is a single bounded context; if a linguistic boundary emerges later, introduce `CONTEXT-MAP.md` and split per-context glossaries.

## Glossary

| Term | Definition | Code / DB Preference |
| ---- | ---------- | -------------------- |
| **User** | A person authenticated into the application | `users` table |
| **Workspace** | The top-level tenant boundary that owns Folders, Notes, and Sources | `workspaces` table (renamed from `organizations`) |
| **Folder** | A directory containing Notes and optionally a Folder Cover | `folders` table |
| **Note** | A file written or uploaded by the User, usually Markdown | `notes` table |
| **Folder Cover** | A special Note named `folder-cover.md` that describes a Folder | `notes` table with a special role |
| **Source** | External material attached to a Note (e.g. a YouTube video, PDF) | `sources` table |
| **Tag** | A label attached to a Note | `tags` table / `note_tags` join table |
| **Link** | An explicit reference from one Note to another Note | `links` table |
| **Concept** | An idea, entity, or topic extracted from Notes | `concepts` table |
| **Relation** | A typed link between two Concepts | `relations` table |
| **Mention** | A specific occurrence of a Concept inside a particular Note | `mentions` table |
| **Chunk** | A segment of a Note used for embedding and vector search | `chunks` table |
| **Embedding** | The vector representation of a Chunk or Concept | `chunks.embedding` / `concepts.embedding` |
| **Query** | A natural-language question from the User | Request payload |
| **Answer** | The LLM-generated response to a Query | Response payload |
| **Context** | The assembled Notes, Concepts, Relations, and Sources used to generate an Answer | Runtime object |
| **Agent** | The component that uses Tools to retrieve Context and generate an Answer | Server-side service |
| **Tool** | A function the Agent can call to retrieve information | Function / API endpoint |
| **Sync** | The process of ingesting Notes from a local folder on disk | Background job / worker |
| **Ingestion** | The overall process of bringing Notes into the system and extracting graph + vectors | Pipeline |

## Relationships

- A **User** owns one or more **Workspaces**.
- A **Workspace** has many **Folders**.
- A **Workspace** has many **Notes** via **Folders**. Every **Note** belongs to exactly one **Folder** (top-level files live in the root **Folder**).
- A **Workspace** has many **Sources**. A **Source** belongs to one **Workspace** and can be attached to one or more **Notes**.
- A **Folder** belongs to one **Workspace**.
- A **Folder** has many **Notes**.
- A **Folder** has zero or one **Folder Cover**.
- A **Folder** can contain other **Folders** (nested tree).
- A **Note** belongs to one **Folder**.
- A **Note** has many **Chunks**.
- A **Note** has many **Sources**.
- A **Note** has many **Tags**.
- A **Note** has many outgoing **Links** to other **Notes**.
- A **Note** has many incoming **Links** from other **Notes**.
- A **Chunk** belongs to exactly one **Note**.
- A **Concept** belongs to exactly one **Workspace** and can be derived from many **Notes**.
- A **Mention** links exactly one **Concept** to exactly one **Note**.
- A **Relation** belongs to exactly one **Workspace** and links exactly two **Concepts**.
- A **Query** produces one **Answer** and a list of **Notes**.

## Tech Stack (Existing)

- **Frontend**: Nuxt.js 3, Tailwind CSS, TypeScript, Vue 3 Composition API
- **Backend**: Nitro (Nuxt server), Kysely ORM, PostgreSQL
- **Auth**: BetterAuth (email/password with verification)
- **Database extensions**: `pgvector` for embeddings; `apache-age` for graph storage and traversal
- **Queue**: Existing worker/queue system for background ingestion
- **Testing**: Vitest with e2e support
- **AI Provider**: OpenRouter (strategy pattern for swappable providers)
- **LLM**: `deepseek/deepseek-v4-flash` via OpenRouter
- **Embedding**: `nvidia/llama-nemotron-embed-vl-1b-v2:free` via OpenRouter

## Existing Infrastructure

- User authentication with email verification
- Legacy organization creation on signup (to be migrated to Workspace model)
- Database migrations pipeline
- Queue/worker system for background jobs
- Admin panel scaffold (may be repurposed for knowledge management UI)
- Notifications system

## Decisions Made

1. **Product pivot.** The application is no longer a Telegram membership SaaS. It is a personal knowledge assistant with agentic graph-RAG.
2. **Domain term: Workspace.** The legacy `organizations` table will be renamed to `workspaces`. `Workspace` is the user-facing and code-facing term for the tenant boundary.
3. **Single-user MVP.** The first version supports one User. Multi-tenant architecture is preserved in the data model for future sharing or team Workspaces.
4. **Ingestion primary path: Sync.** Notes are ingested from a synced local folder. Writing notes in the app is also supported. Future ingestion types include transcribed videos and Excalidraw files.
5. **Folder structure mirrors disk.** A Folder is a directory. Nested folders are supported. Each Folder may contain a `folder-cover.md` Note describing the Folder.
6. **Note = one file.** A Note is a file. A Note can reference multiple Sources, but a Source is not the Note file itself.
7. **Graph is derived.** Concepts, Relations, and Mentions are extracted from Notes by the system. The User cannot edit them directly.
8. **User influence on the graph.** The User can add Links between Notes and add/remove Tags. These can influence derived graph structure and retrieval.
9. **Agentic retrieval.** The Agent answers Queries using Tools rather than a fixed retrieval pipeline. Initial Tools: `search_notes`, `search_concepts`, `get_concept_neighbors`, `get_mentions`, `read_note`, `find_paths_between`, and `search_sources`.
10. **Query response format.** A Query returns an Answer and a list of Notes.
11. **LightRAG inspiration, not implementation.** We borrow the idea of hybrid graph + vector retrieval but delegate orchestration to the Agent.
12. **Postgres-native with Apache AGE.** Vectors live in PostgreSQL via `pgvector`. The graph lives in Apache AGE from the start, storing vertices and edges as regular Postgres tables queried via Cypher.
13. **MVP file types.** Markdown is the primary format. Plain text and maybe a small set of other text-based formats are acceptable for launch. Rich media (PDF, video, Excalidraw) is post-MVP.
14. **Auth retained.** BetterAuth remains for the single User login. Signup and organization-onboarding flows will be simplified or removed for the single-user case.
15. **No manual graph editing.** The graph UI is for visualization and exploration, not for creating or editing Concepts/Relations directly.
16. **AI provider: OpenRouter.** Both LLM and embeddings go through OpenRouter. All AI-related components (embedding, vector search, agentic queries, model calls) use a strategy pattern with interfaces/contracts for easy swapping.
17. **LLM and embedding models.** LLM: `deepseek/deepseek-v4-flash`. Embedding: `nvidia/llama-nemotron-embed-vl-1b-v2:free`. Both are OpenRouter free-tier models.
18. **Sync trigger.** Sync runs on file change with a 5-minute debounce, plus a manual "Sync now" button. The 5-minute window captures a batch of edits without re-ingesting on every keystroke.
19. **Agent memory.** The Agent has session memory scoped to a chat conversation. A conversation is a persisted thread with an ID, stored in the database, so it can be resumed within the same sitting. Context does not carry over between separate conversations, and there is no cross-conversation memory in the MVP.
20. **Graph visualization.** Both a network graph (interactive force-directed layout) and a concept list are available in the UI.
21. **Hybrid Tags.** Tags are extracted by AI and can be added/removed by the User.
22. **Rename detection via content hash.** When a file is renamed, Sync compares content hashes. If hashes match, the Note path is updated without re-running extraction. If hashes differ, the change is treated as delete + create and extraction reruns.

## Open Questions / Need Decisions

All initial product decisions resolved. Ready to move to architecture and implementation planning.

## Assumptions

- A User owns one Workspace in the MVP.
- A Folder maps to a directory on disk.
- A Note is a single file.
- The graph is derived from Notes and is read-only to the User.
- A Query returns an Answer plus a list of Notes.
- The system uses PostgreSQL for both relational data and vector storage.
- External AI services are used for embedding, concept extraction, and answer generation in the MVP.
- Sync is the primary ingestion mechanism; in-app writing is secondary.
- Future media types (video, Excalidraw) will be transcribed or parsed into text before graph extraction.
