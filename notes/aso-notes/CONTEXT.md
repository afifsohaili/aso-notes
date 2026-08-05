# Personal Knowledge Assistant

An agentic graph-RAG system over personal notes. Notes are ingested from synced folders, a graph of Concepts and Relations is derived from them, and an Agent answers Queries using retrieval Tools.

## Language

### Tenancy & Identity

**User**:
A person authenticated into the application.
_Avoid_: Account, profile, identity

**Workspace**:
The top-level tenant boundary that owns Folders, Notes, and Sources.
_Avoid_: Organization, vault, space

**Onboarding**:
The first-run setup flow: the settings page runs in wizard mode and gates the app until the user has configured a Synced Folder and LLM providers, and a smoke-test Note has completed Ingestion. Recorded as `onboarding.completed_at` in workspace settings; first-run only, never re-gates.
_Avoid_: Setup wizard, getting started

### Notes & Content

**Note**:
A file written or uploaded by the User — Markdown, plain text, PDF, anything. A Note belongs to exactly one Folder.
_Avoid_: Document, page, file

**Folder**:
A directory containing Notes and optionally a Folder Cover. Folders can nest. A Folder belongs to exactly one Synced Folder; the tree rendered in the /notes sidebar is per-root, so the same relative path in two Synced Folders produces two separate Folders.
_Avoid_: Directory, vault, collection

**Folder Cover**:
A special file named `__folder-cover.md` that describes the Folder it lives in.
_Avoid_: Readme, index, about

**Source**:
External material attached to one or more Notes (e.g. a YouTube video, PDF). Belongs to one Workspace.
_Avoid_: Reference, attachment, resource

**Tag**:
A label attached to a Note. AI-suggested and user-editable.
_Avoid_: Label, category

**Link**:
An explicit user-created reference from one Note to another Note.
_Avoid_: Backlink, mention, reference

### Graph

**Topic**:
A high-level theme that groups related Concepts across the Workspace. AI-assigned during Ingestion and reused across Notes.
_Avoid_: Category, subject

**Concept**:
A granular idea or entity extracted from Notes. Belongs to one Workspace and sits under one or more Topics.
_Avoid_: Entity, node

**Relation**:
A typed link between two Concepts. Belongs to one Workspace.
_Avoid_: Edge, connection

**Mention**:
A specific occurrence of a Concept inside a particular Note.
_Avoid_: Reference, occurrence

### Agentic RAG

**Chunk**:
A segment of a Note used for embedding and vector search.
_Avoid_: Fragment, passage, block

**Query**:
A natural-language question asked by the User.
_Avoid_: Question, search, prompt

**Context**:
The assembled Notes, Concepts, Relations, and Sources used to answer a Query. In architecture docs, always write "Bounded Context" in full for the DDD meaning — bare "Context" means this term.
_Avoid_: Evidence, retrieved data

**Answer**:
The LLM-generated response to a Query, returned with a list of Notes.
_Avoid_: Response, result, reply

**Agent**:
The component that uses Tools to retrieve Context and generate an Answer.
_Avoid_: Chatbot, pipeline, bot

**Tool**:
A function the Agent can call to retrieve information (e.g. `search_notes`, `find_paths_between`).
_Avoid_: Function, capability

**Conversation**:
A persisted chat thread between the User and the Agent, with session memory scoped to the thread.
_Avoid_: Session, chat, thread

### Ingestion

**Synced Folder**:
A top-level directory on disk registered in the database (per Workspace) whose contents are synced. Replaces the old `NUXT_NOTES_DIR` env var; multiple Synced Folders per Workspace are supported. Removing one wipes its Notes and garbage-collects orphaned graph rows.
_Avoid_: Sync root, vault, notes dir

**Synced Folder Alias**:
A user-set display name for a Synced Folder (nullable `alias` column), editable from Settings. When set, it replaces the Root Label everywhere — sidebar, graph, settings — and exempts the Synced Folder from Root Collision handling.
_Avoid_: Nickname, rename, custom name

**Root Label**:
The display name of a Synced Folder: Alias ?? basename of its absolute path. Computed server-side; clients never re-derive it.
_Avoid_: Folder name, root name (bare — `rootName` is the JSON field carrying it in graph payloads)

**Root Collision**:
When two or more Synced Folders in a Workspace share the same basename and none has an Alias. The UI disambiguates by prepending the minimal distinguishing parent-path segment(s) — rendered as a gray prefix in the /notes sidebar (e.g. `justjom/ plans`) and inside the `<…>` suffix on graph Note labels (e.g. `plan-005 <justjom/plans>`).
_Avoid_: Duplicate folder, name clash

**Sync**:
The process of ingesting Notes from Synced Folders on disk, watching for changes with a debounce.
_Avoid_: Watch, import, poll

**Ingestion**:
The overall pipeline of bringing Notes into the system and extracting the graph.
_Avoid_: Import, processing

**Ingestion Run**:
A single execution of the Ingestion pipeline for one Note. Only the latest Run is recorded (on the Note itself); no Run history is kept.
_Avoid_: Extraction job, outbox entry, attempt log

**Note Status**:
Lifecycle state of a Note row: `pending` (settling, not yet queued), `queued` (dispatched to BullMQ, waiting for a worker), `processing` (a worker is actively running the Ingestion pipeline), `ingested` (pipeline succeeded), `failed` (pipeline failed or was declared failed by BullMQ after retries).
_Avoid_: State, job state, stage

### Consolidation

**Consolidation**:
The AI-driven process that cleans a Workspace's vocabulary by merging duplicate Concepts, merging similar Topics, re-filing Concepts under the right Topics, pruning junk Concepts, and rewriting descriptions. Runs automatically on a schedule and can be triggered manually from Settings.
_Avoid_: Ontology cleanup, vocabulary merge

**Consolidation Run**:
A single execution of Consolidation for one Workspace. Recorded in `consolidation_runs` with mode (`incremental`, `full`, `manual`), status, counts, usage, and before/after metrics.
_Avoid_: Cleanup job, vocabulary pass

**Change**:
A human-readable record of one action performed during a Consolidation Run (merge, prune, refile, rewrite, or dissolve), including the entity names and the judge's reason. Displayed in the run detail feed.
_Avoid_: Diff, delta, audit entry

**Flag**:
An automatic warning attached to a Consolidation Run when structural metrics indicate over-pruning or ineffectiveness. Flags advise the user; they do not block the run.
_Avoid_: Alert, notification, badge

**Snapshot**:
A point-in-time JSONB dump of a Workspace's five graph tables (`concepts`, `topics`, `concept_topics`, `relations`, `mentions`) captured before each Consolidation Run. Used to restore the vocabulary to a previous state.
_Avoid_: Backup, checkpoint, version
