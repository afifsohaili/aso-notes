import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * M1 — notes domain schema (plans/002-system/plan-002-system.md).
 *
 * Relational source of truth for the agentic graph-RAG notes app, plus the
 * Apache AGE graph `notes_graph` that mirrors it. Embedding columns are
 * halfvec(2048): the locked embedding model nvidia/llama-nemotron-embed-vl-1b-v2
 * outputs 2048-dimension embeddings (model card:
 * https://huggingface.co/nvidia/llama-nemotron-embed-vl-1b-v2), and pgvector
 * HNSW caps `vector` at 2000 dimensions, so half-precision halfvec (limit
 * 4000) is used to keep the columns HNSW-indexable.
 *
 * Plan-silent decisions made here (recorded in the plan):
 * - notes.folder_id is nullable, ON DELETE SET NULL — path strings are the
 *   identity model; root notes have no folder row and losing a folder row
 *   must not destroy notes.
 * - messages also carries workspace_id (blanket tenant rule), though the
 *   plan's column list omits it; cascade still works via conversations.
 * - messages.role gets a CHECK constraint like notes.status / note_tags.origin.
 * - mentions has no timestamps (per plan); note_tags / note_tag_dismissals
 *   use composite primary keys (note_id, tag_id) per the plan's column lists.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- folders -------------------------------------------------------------
  await db.schema
    .createTable('folders')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('path', 'varchar', col => col.notNull())
    .addColumn('cover_content', 'text')
    .addColumn('cover_hash', 'varchar')
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('folders_workspace_path_unique')
    .on('folders')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()

  // --- notes ---------------------------------------------------------------
  await db.schema
    .createTable('notes')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('folder_id', 'uuid', col => col.references('folders.id').onDelete('set null'))
    .addColumn('path', 'varchar', col => col.notNull())
    .addColumn('title', 'varchar', col => col.notNull())
    .addColumn('content', 'text')
    .addColumn('content_hash', 'varchar')
    .addColumn('ingested_hash', 'varchar')
    .addColumn('status', 'varchar', col => col.notNull().defaultTo('pending'))
    .addColumn('pipeline', 'varchar', col => col.notNull().defaultTo('markdown-note'))
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addCheckConstraint('notes_status_check', sql`status IN ('pending', 'ingested', 'failed')`)
    .execute()

  await db.schema
    .createIndex('notes_workspace_path_unique')
    .on('notes')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()

  // Sweeper query: WHERE status='pending' AND updated_at < now() - interval '5 minutes'
  await db.schema
    .createIndex('idx_notes_status_updated_at')
    .on('notes')
    .columns(['status', 'updated_at'])
    .execute()

  // --- chunks --------------------------------------------------------------
  await db.schema
    .createTable('chunks')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('note_id', 'uuid', col => col.notNull().references('notes.id').onDelete('cascade'))
    .addColumn('seq', 'integer', col => col.notNull())
    .addColumn('text', 'text', col => col.notNull())
    .addColumn('token_count', 'integer')
    .addColumn('embedding', sql`halfvec(2048)`)
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('idx_chunks_note_id')
    .on('chunks')
    .column('note_id')
    .execute()

  await sql`CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding halfvec_cosine_ops)`.execute(db)

  // --- concepts ------------------------------------------------------------
  await db.schema
    .createTable('concepts')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('name', 'varchar', col => col.notNull())
    .addColumn('name_normalized', 'varchar', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('embedding', sql`halfvec(2048)`)
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('concepts_workspace_name_normalized_unique')
    .on('concepts')
    .columns(['workspace_id', 'name_normalized'])
    .unique()
    .execute()

  await sql`CREATE INDEX idx_concepts_embedding_hnsw ON concepts USING hnsw (embedding halfvec_cosine_ops)`.execute(db)

  // --- relations -----------------------------------------------------------
  await db.schema
    .createTable('relations')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('from_concept_id', 'uuid', col => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('to_concept_id', 'uuid', col => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('type', 'varchar', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  // --- mentions ------------------------------------------------------------
  await db.schema
    .createTable('mentions')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('chunk_id', 'uuid', col => col.notNull().references('chunks.id').onDelete('cascade'))
    .addColumn('concept_id', 'uuid', col => col.notNull().references('concepts.id').onDelete('cascade'))
    .execute()

  await db.schema
    .createIndex('mentions_chunk_concept_unique')
    .on('mentions')
    .columns(['chunk_id', 'concept_id'])
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_mentions_concept_id')
    .on('mentions')
    .column('concept_id')
    .execute()

  // --- tags ----------------------------------------------------------------
  await db.schema
    .createTable('tags')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('name', 'varchar', col => col.notNull())
    .addColumn('name_normalized', 'varchar', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('tags_workspace_name_normalized_unique')
    .on('tags')
    .columns(['workspace_id', 'name_normalized'])
    .unique()
    .execute()

  // --- note_tags -----------------------------------------------------------
  await db.schema
    .createTable('note_tags')
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('note_id', 'uuid', col => col.notNull().references('notes.id').onDelete('cascade'))
    .addColumn('tag_id', 'uuid', col => col.notNull().references('tags.id').onDelete('cascade'))
    .addColumn('origin', 'varchar', col => col.notNull())
    .addPrimaryKeyConstraint('note_tags_pkey', ['note_id', 'tag_id'])
    .addCheckConstraint('note_tags_origin_check', sql`origin IN ('user', 'ai')`)
    .execute()

  // --- note_tag_dismissals -------------------------------------------------
  await db.schema
    .createTable('note_tag_dismissals')
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('note_id', 'uuid', col => col.notNull().references('notes.id').onDelete('cascade'))
    .addColumn('tag_id', 'uuid', col => col.notNull().references('tags.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addPrimaryKeyConstraint('note_tag_dismissals_pkey', ['note_id', 'tag_id'])
    .execute()

  // --- links ---------------------------------------------------------------
  await db.schema
    .createTable('links')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('from_note_id', 'uuid', col => col.notNull().references('notes.id').onDelete('cascade'))
    .addColumn('to_note_id', 'uuid', col => col.references('notes.id').onDelete('cascade'))
    .addColumn('raw_target', 'varchar', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('idx_links_from_note_id')
    .on('links')
    .column('from_note_id')
    .execute()

  await db.schema
    .createIndex('idx_links_to_note_id')
    .on('links')
    .column('to_note_id')
    .execute()

  // --- sources -------------------------------------------------------------
  await db.schema
    .createTable('sources')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('note_id', 'uuid', col => col.notNull().references('notes.id').onDelete('cascade'))
    .addColumn('url', 'text', col => col.notNull())
    .addColumn('url_normalized', 'text', col => col.notNull())
    .addColumn('title', 'varchar')
    .addColumn('type', 'varchar')
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('sources_note_url_normalized_unique')
    .on('sources')
    .columns(['note_id', 'url_normalized'])
    .unique()
    .execute()

  // --- conversations -------------------------------------------------------
  await db.schema
    .createTable('conversations')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('title', 'varchar')
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  // --- messages ------------------------------------------------------------
  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('conversation_id', 'uuid', col => col.notNull().references('conversations.id').onDelete('cascade'))
    .addColumn('role', 'varchar', col => col.notNull())
    .addColumn('content', 'text')
    .addColumn('tool_calls', 'jsonb')
    .addColumn('tool_call_id', 'varchar')
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addCheckConstraint('messages_role_check', sql`role IN ('user', 'assistant', 'tool')`)
    .execute()

  await db.schema
    .createIndex('idx_messages_conversation_id')
    .on('messages')
    .column('conversation_id')
    .execute()

  // --- AGE graph (derived mirror) -------------------------------------------
  await sql`SELECT ag_catalog.create_graph('notes_graph')`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`SELECT ag_catalog.drop_graph('notes_graph', true)`.execute(db)

  await db.schema.dropTable('messages').execute()
  await db.schema.dropTable('conversations').execute()
  await db.schema.dropTable('sources').execute()
  await db.schema.dropTable('links').execute()
  await db.schema.dropTable('note_tag_dismissals').execute()
  await db.schema.dropTable('note_tags').execute()
  await db.schema.dropTable('tags').execute()
  await db.schema.dropTable('mentions').execute()
  await db.schema.dropTable('relations').execute()
  await db.schema.dropTable('concepts').execute()
  await db.schema.dropTable('chunks').execute()
  await db.schema.dropTable('notes').execute()
  await db.schema.dropTable('folders').execute()
}
