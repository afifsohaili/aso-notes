import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Phase 1 (plan-011) — LLM Usage Recording & Tracing data model.
 *
 * Three workspace-scoped tables that record every LLM Trace, the Generations
 * (model request/response pairs) inside it, and the Tool Calls the Agent makes.
 *
 * Traces are polymorphic: owner_type stores the exact table name of the owner
 * (notes | conversations | consolidation_runs) and owner_id is the PK. No FK
 * is enforced so owners can be deleted without blocking trace retention, and a
 * trace can outlive ephemeral owners if needed later.
 *
 * Generations and Tool Calls are flat per trace, ordered by seq. Content columns
 * (prompt, response, output) are nullable and carry a pruned_at timestamp so the
 * retention job can null large payloads while keeping cost/token metadata.
 *
 * Messages are linked to a trace via a nullable trace_id column so a chat
 * Answer can be correlated with its full trace without enforcing FK deletion.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- llm_traces ----------------------------------------------------------
  await db.schema
    .createTable('llm_traces')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('kind', 'varchar', col => col.notNull()) // ingestion | chat | consolidation
    .addColumn('owner_type', 'varchar', col => col.notNull()) // notes | conversations | consolidation_runs
    .addColumn('owner_id', 'uuid', col => col.notNull())
    .addColumn('status', 'varchar', col => col.notNull().defaultTo('running')) // running | completed | failed | aborted
    .addColumn('started_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamp')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('llm_traces_workspace_id_owner_lookup_idx')
    .on('llm_traces')
    .columns(['workspace_id', 'owner_type', 'owner_id'])
    .execute()

  await db.schema
    .createIndex('llm_traces_status_started_at_idx')
    .on('llm_traces')
    .columns(['status', 'started_at'])
    .execute()

  // --- llm_generations -------------------------------------------------------
  await db.schema
    .createTable('llm_generations')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('trace_id', 'uuid', col => col.notNull().references('llm_traces.id').onDelete('cascade'))
    .addColumn('seq', 'integer', col => col.notNull())
    .addColumn('llm_use_case', 'varchar', col => col.notNull()) // agent | extraction | embedding | consolidation
    .addColumn('provider', 'varchar', col => col.notNull())
    .addColumn('model', 'varchar', col => col.notNull())
    .addColumn('prompt', 'jsonb')
    .addColumn('response', 'jsonb')
    .addColumn('prompt_tokens', 'integer')
    .addColumn('completion_tokens', 'integer')
    .addColumn('cost_usd', sql`numeric(12,6)`)
    .addColumn('latency_ms', 'integer')
    .addColumn('finish_reason', 'varchar')
    .addColumn('error', 'text')
    .addColumn('pruned_at', 'timestamp')
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('llm_generations_trace_id_seq_idx')
    .on('llm_generations')
    .columns(['trace_id', 'seq'])
    .execute()

  await db.schema
    .createIndex('llm_generations_pruned_at_idx')
    .on('llm_generations')
    .column('pruned_at')
    .where('pruned_at', 'is', null)
    .execute()

  // --- llm_tool_calls --------------------------------------------------------
  await db.schema
    .createTable('llm_tool_calls')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('trace_id', 'uuid', col => col.notNull().references('llm_traces.id').onDelete('cascade'))
    .addColumn('seq', 'integer', col => col.notNull())
    .addColumn('name', 'varchar', col => col.notNull())
    .addColumn('input', 'jsonb', col => col.notNull())
    .addColumn('output', 'jsonb')
    .addColumn('duration_ms', 'integer')
    .addColumn('status', 'varchar', col => col.notNull())
    .addColumn('pruned_at', 'timestamp')
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('llm_tool_calls_trace_id_seq_idx')
    .on('llm_tool_calls')
    .columns(['trace_id', 'seq'])
    .execute()

  await db.schema
    .createIndex('llm_tool_calls_pruned_at_idx')
    .on('llm_tool_calls')
    .column('pruned_at')
    .where('pruned_at', 'is', null)
    .execute()

  // --- messages.trace_id ----------------------------------------------------
  await db.schema
    .alterTable('messages')
    .addColumn('trace_id', 'uuid')
    .execute()

  await db.schema
    .createIndex('idx_messages_trace_id')
    .on('messages')
    .column('trace_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_messages_trace_id').ifExists().execute()
  await db.schema
    .alterTable('messages')
    .dropColumn('trace_id')
    .execute()

  await db.schema.dropIndex('llm_tool_calls_pruned_at_idx').ifExists().execute()
  await db.schema.dropIndex('llm_tool_calls_trace_id_seq_idx').ifExists().execute()
  await db.schema.dropTable('llm_tool_calls').execute()

  await db.schema.dropIndex('llm_generations_pruned_at_idx').ifExists().execute()
  await db.schema.dropIndex('llm_generations_trace_id_seq_idx').ifExists().execute()
  await db.schema.dropTable('llm_generations').execute()

  await db.schema.dropIndex('llm_traces_status_started_at_idx').ifExists().execute()
  await db.schema.dropIndex('llm_traces_workspace_id_owner_lookup_idx').ifExists().execute()
  await db.schema.dropTable('llm_traces').execute()
}
