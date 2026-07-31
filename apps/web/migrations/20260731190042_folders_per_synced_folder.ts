import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Phase 8 (plan-007) — Folders become per-Synced-Folder.
 *
 * The `folders` table was workspace-scoped in Phase 2, so two Synced Folders
 * with the same relative path shared one row and the notes UI merged their
 * trees. This migration adds `folders.synced_folder_id` and switches
 * uniqueness to `(synced_folder_id, path)`.
 *
 * Backfill decisions (recorded as divergences):
 * - Folders containing notes are split into one row per distinct
 *   `synced_folder_id` of their member notes; notes are repointed to the
 *   matching new row.
 * - Folders empty from the start (including a '/' root row with no
 *   root-level notes) are attached to the workspace's first-created Synced
 *   Folder. Root-cover content therefore follows the first root; other
 *   roots will get fresh '/' rows and any missing root covers will be
 *   recreated by the next sync scan.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Add the new column (nullable during backfill).
  await db.schema
    .alterTable('folders')
    .addColumn('synced_folder_id', 'uuid', col => col.references('synced_folders.id').onDelete('cascade'))
    .execute()

  // Drop the old workspace-scoped unique index before backfill so the same
  // relative path can exist once per Synced Folder.
  await db.schema.dropIndex('folders_workspace_path_unique').ifExists().execute()

  // 0. Snapshot rows that are empty BEFORE any repointing. After step 2
  //    every old row has zero member notes, so this set must be captured
  //    first — otherwise step 3 copies every old folder into the first
  //    Synced Folder (phantom 0-count folders under the wrong root).
  await sql`
    CREATE TEMPORARY TABLE empty_folder_ids AS
    SELECT f.id FROM folders f
    WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.folder_id = f.id)
  `.execute(db)

  // 1. Create one new folder row per (synced_folder_id, path) that has notes.
  await sql`
    INSERT INTO folders (workspace_id, synced_folder_id, path, cover_content, cover_hash)
    SELECT DISTINCT
      f.workspace_id,
      n.synced_folder_id,
      f.path,
      f.cover_content,
      f.cover_hash
    FROM folders f
    INNER JOIN notes n ON n.folder_id = f.id
    WHERE n.synced_folder_id IS NOT NULL
  `.execute(db)

  // 2. Repoint notes to the new per-root folder rows.
  await sql`
    UPDATE notes n
    SET folder_id = nf.id
    FROM folders nf, folders old
    WHERE nf.workspace_id = n.workspace_id
      AND nf.synced_folder_id = n.synced_folder_id
      AND nf.path = old.path
      AND old.id = n.folder_id
      AND old.synced_folder_id IS NULL
  `.execute(db)

  // 3. Folder rows that were empty from the start (including '/' when it
  //    had no root-level notes) attach to the first-created Synced Folder of
  //    the workspace so covers are not lost.
  await sql`
    INSERT INTO folders (workspace_id, synced_folder_id, path, cover_content, cover_hash)
    SELECT f.workspace_id, sf.id, f.path, f.cover_content, f.cover_hash
    FROM folders f
    CROSS JOIN LATERAL (
      SELECT id FROM synced_folders
      WHERE workspace_id = f.workspace_id
      ORDER BY created_at ASC
      LIMIT 1
    ) sf
    WHERE f.synced_folder_id IS NULL
      AND f.id IN (SELECT id FROM empty_folder_ids)
  `.execute(db)

  // 4. Ensure every Synced Folder has a '/' row (used for root covers). It may
  //    already exist from step 1/3; skip conflicts.
  await sql`
    INSERT INTO folders (workspace_id, synced_folder_id, path)
    SELECT sf.workspace_id, sf.id, '/'
    FROM synced_folders sf
    WHERE NOT EXISTS (
      SELECT 1 FROM folders f2
      WHERE f2.workspace_id = sf.workspace_id
        AND f2.synced_folder_id = sf.id
        AND f2.path = '/'
    )
  `.execute(db)

  // 5. Remove the old workspace-scoped rows.
  await sql`DELETE FROM folders WHERE synced_folder_id IS NULL`.execute(db)

  // 6. Enforce NOT NULL and the new unique index.
  await db.schema
    .alterTable('folders')
    .alterColumn('synced_folder_id', col => col.setNotNull())
    .execute()

  await db.schema
    .createIndex('folders_synced_folder_path_unique')
    .on('folders')
    .columns(['synced_folder_id', 'path'])
    .unique()
    .execute()

  await db.schema
    .createIndex('folders_synced_folder_id_idx')
    .on('folders')
    .column('synced_folder_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('folders_synced_folder_id_idx').ifExists().execute()
  await db.schema.dropIndex('folders_synced_folder_path_unique').ifExists().execute()
  await db.schema
    .createIndex('folders_workspace_path_unique')
    .on('folders')
    .columns(['workspace_id', 'path'])
    .unique()
    .execute()
  await db.schema
    .alterTable('folders')
    .dropColumn('synced_folder_id')
    .execute()
}
