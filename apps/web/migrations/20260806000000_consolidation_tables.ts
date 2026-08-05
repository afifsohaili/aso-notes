import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * M — consolidation run bookkeeping (plan-010, Phase 1).
 *
 * Three workspace-scoped tables backing Consolidation runs:
 *  - consolidation_runs: one row per run — mode (incremental|full|manual),
 *    status (running|completed|failed), started/finished, change counts
 *    (merges/prunes/refiles/rewrites), LLM usage, before/after structural
 *    metrics, flags, and error text.
 *  - consolidation_snapshots: one JSONB payload per run — a self-contained
 *    dump of the 5 graph tables (concepts, topics, concept_topics, relations,
 *    mentions) used for restore + audit. Retention is enforced at the app
 *    layer (last 10 runs).
 *  - consolidation_run_changes: one row per executed change
 *    (merge-concept|merge-topic|prune|rewrite|dissolve|refile) with the
 *    human-readable line and the LLM judge's reason — written at execution
 *    time (observability; no snapshot diffing).
 *
 * All rows cascade on workspace delete; snapshot + change rows cascade on
 * run delete. Workspace scoping for changes is reached through their run.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- consolidation_runs ---------------------------------------------------
  await db.schema
    .createTable('consolidation_runs')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('mode', 'varchar', col => col.notNull()) // incremental | full | manual
    .addColumn('status', 'varchar', col => col.notNull().defaultTo('running')) // running | completed | failed
    .addColumn('started_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamp')
    .addColumn('counts', 'jsonb') // { merge, prune, refile, rewrite, ... }
    .addColumn('usage', 'jsonb') // { prompt_tokens, completion_tokens, ... }
    .addColumn('metrics_before', 'jsonb')
    .addColumn('metrics_after', 'jsonb')
    .addColumn('flags', 'jsonb')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('consolidation_runs_workspace_id_idx')
    .on('consolidation_runs')
    .columns(['workspace_id'])
    .execute()

  // --- consolidation_snapshots ----------------------------------------------
  await db.schema
    .createTable('consolidation_snapshots')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('run_id', 'uuid', col => col.notNull().references('consolidation_runs.id').onDelete('cascade'))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('payload', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('consolidation_snapshots_run_id_idx')
    .on('consolidation_snapshots')
    .columns(['run_id'])
    .execute()

  await db.schema
    .createIndex('consolidation_snapshots_workspace_id_idx')
    .on('consolidation_snapshots')
    .columns(['workspace_id'])
    .execute()

  // --- consolidation_run_changes --------------------------------------------
  await db.schema
    .createTable('consolidation_run_changes')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('run_id', 'uuid', col => col.notNull().references('consolidation_runs.id').onDelete('cascade'))
    .addColumn('action', 'varchar', col => col.notNull()) // merge-concept | merge-topic | prune | rewrite | dissolve | refile
    .addColumn('text', 'varchar', col => col.notNull())
    .addColumn('reason', 'text')
    .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('consolidation_run_changes_run_id_idx')
    .on('consolidation_run_changes')
    .columns(['run_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('consolidation_run_changes').execute()
  await db.schema.dropTable('consolidation_snapshots').execute()
  await db.schema.dropTable('consolidation_runs').execute()
}
