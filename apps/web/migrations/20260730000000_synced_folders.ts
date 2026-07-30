import type { Kysely } from 'kysely'
import process from 'node:process'
import { sql } from 'kysely'

/**
 * Phase 2 (plan-007) — Synced Folder data model.
 *
 * Replaces the single NUXT_NOTES_DIR env var with a workspace-scoped
 * synced_folders table. Notes now belong to exactly one Synced Folder and
 * paths are relative per-root, so note uniqueness is composite
 * (synced_folder_id, path).
 *
 * Backfill decision: this is a clean break with no real installs, so the
 * migration creates one default Synced Folder per existing workspace. If
 * NUXT_NOTES_DIR is set in the migration environment, that path is used;
 * otherwise a placeholder is used. Existing notes are attached to that folder.
 * A BEFORE INSERT trigger provides a fallback synced_folder_id for legacy/test
 * inserts that do not supply one, avoiding a broad test-fixture churn while
 * keeping the column NOT NULL in the database.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // --- synced_folders ------------------------------------------------------
  await db.schema
    .createTable('synced_folders')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', col => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('path', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  await db.schema
    .createIndex('synced_folders_workspace_path_unique')
    .on('synced_folders')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()

  // Backfill one Synced Folder per workspace for existing data.
  const envDir = process.env.NUXT_NOTES_DIR || '__default_synced_folder__'
  await sql`
    INSERT INTO synced_folders (workspace_id, path)
    SELECT id, ${envDir}
    FROM workspaces
  `.execute(db)

  // --- notes: synced_folder_id ---------------------------------------------
  await db.schema
    .alterTable('notes')
    .addColumn('synced_folder_id', 'uuid', col => col.references('synced_folders.id').onDelete('cascade'))
    .execute()

  await sql`
    UPDATE notes
    SET synced_folder_id = synced_folders.id
    FROM synced_folders
    WHERE notes.workspace_id = synced_folders.workspace_id
  `.execute(db)

  await db.schema
    .alterTable('notes')
    .alterColumn('synced_folder_id', col => col.setNotNull())
    .execute()

  // Replace workspace-wide path uniqueness with per-root uniqueness.
  await db.schema.dropIndex('notes_workspace_path_unique').ifExists().execute()
  await db.schema
    .createIndex('notes_synced_folder_path_unique')
    .on('notes')
    .columns(['synced_folder_id', 'path'])
    .unique()
    .execute()

  // Legacy/test inserts that omit synced_folder_id pick the workspace's first
  // Synced Folder; if none exists, a placeholder is created. Application code
  // always supplies the value explicitly.
  await sql`
    CREATE OR REPLACE FUNCTION trg_notes_default_synced_folder()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.synced_folder_id IS NULL THEN
        NEW.synced_folder_id := (
          SELECT id FROM synced_folders WHERE workspace_id = NEW.workspace_id LIMIT 1
        );
      END IF;
      IF NEW.synced_folder_id IS NULL THEN
        INSERT INTO synced_folders (workspace_id, path)
        VALUES (NEW.workspace_id, '__default_synced_folder__')
        RETURNING id INTO NEW.synced_folder_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db)
  await sql`
    CREATE TRIGGER notes_default_synced_folder
    BEFORE INSERT ON notes
    FOR EACH ROW
    EXECUTE FUNCTION trg_notes_default_synced_folder()
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS notes_default_synced_folder ON notes`.execute(db)
  await sql`DROP FUNCTION IF EXISTS trg_notes_default_synced_folder()`.execute(db)
  await db.schema.dropIndex('notes_synced_folder_path_unique').ifExists().execute()
  await db.schema
    .createIndex('notes_workspace_path_unique')
    .on('notes')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()
  await db.schema
    .alterTable('notes')
    .dropColumn('synced_folder_id')
    .execute()
  await db.schema.dropIndex('synced_folders_workspace_path_unique').ifExists().execute()
  await db.schema.dropTable('synced_folders').execute()
}
