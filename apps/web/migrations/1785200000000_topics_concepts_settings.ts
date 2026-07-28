import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * M1 — topics + concept_topics + workspace_settings schema (plan-003).
 *
 * Adds the two-tier graph relational layer: Topic (theme) groups Concept.
 * Embeddings stay halfvec(2048) and HNSW-indexed so the same model + index
 * strategy used for concepts/chunks applies to topic consolidation and
 * blind-merge matching. workspace_settings is a per-workspace key/value jsonb
 * store for runtime-tunable extraction options.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- topics ---------------------------------------------------------------
  await db.schema
    .createTable('topics')
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
    .createIndex('topics_workspace_name_normalized_unique')
    .on('topics')
    .columns(['workspace_id', 'name_normalized'])
    .unique()
    .execute()

  await sql`CREATE INDEX idx_topics_embedding_hnsw ON topics USING hnsw (embedding halfvec_cosine_ops)`.execute(db)

  // --- concept_topics -------------------------------------------------------
  // Join table mirroring note_tags: workspace-scoped tenant blanket, composite
  // PK, cascade on both parents, no timestamps.
  await db.schema
    .createTable('concept_topics')
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('concept_id', 'uuid', col => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('topic_id', 'uuid', col => col.notNull().references('topics.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('concept_topics_pkey', ['concept_id', 'topic_id'])
    .execute()

  // --- workspace_settings ---------------------------------------------------
  await db.schema
    .createTable('workspace_settings')
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('key', 'varchar', col => col.notNull())
    .addColumn('value', 'jsonb', col => col.notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addPrimaryKeyConstraint('workspace_settings_pkey', ['workspace_id', 'key'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('workspace_settings').execute()
  await db.schema.dropTable('concept_topics').execute()
  await db.schema.dropTable('topics').execute()
}
