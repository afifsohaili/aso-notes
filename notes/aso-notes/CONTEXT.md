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

### Notes & Content

**Note**:
A file written or uploaded by the User — Markdown, plain text, PDF, anything. A Note belongs to exactly one Folder.
_Avoid_: Document, page, file

**Folder**:
A directory containing Notes and optionally a Folder Cover. Folders can nest.
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

**Sync**:
The process of ingesting Notes from a Folder on disk, watching for changes with a debounce.
_Avoid_: Watch, import, poll

**Ingestion**:
The overall pipeline of bringing Notes into the system and extracting the graph.
_Avoid_: Import, processing
