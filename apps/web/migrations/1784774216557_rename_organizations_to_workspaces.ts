import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Rename the tenant boundary table: organizations -> workspaces
  // Per CONTEXT.md, "Workspace" is the canonical domain term.
  await db.schema
    .alterTable('organizations')
    .renameTo('workspaces')
    .execute()

  // Postgres does not rename constraints when a table is renamed
  await sql`ALTER TABLE workspaces RENAME CONSTRAINT organizations_pkey TO workspaces_pkey`.execute(db)

  // Rename the FK column on memberships
  await db.schema
    .alterTable('memberships')
    .renameColumn('organization_id', 'workspace_id')
    .execute()

  // Postgres does not rename constraints/indexes when a column is renamed
  await sql`ALTER TABLE memberships RENAME CONSTRAINT memberships_organization_id_fkey TO memberships_workspace_id_fkey`.execute(db)
  await sql`ALTER INDEX memberships_user_org_unique RENAME TO memberships_user_workspace_unique`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER INDEX memberships_user_workspace_unique RENAME TO memberships_user_org_unique`.execute(db)
  await sql`ALTER TABLE memberships RENAME CONSTRAINT memberships_workspace_id_fkey TO memberships_organization_id_fkey`.execute(db)

  await db.schema
    .alterTable('memberships')
    .renameColumn('workspace_id', 'organization_id')
    .execute()

  await sql`ALTER TABLE workspaces RENAME CONSTRAINT workspaces_pkey TO organizations_pkey`.execute(db)

  await db.schema
    .alterTable('workspaces')
    .renameTo('organizations')
    .execute()
}
