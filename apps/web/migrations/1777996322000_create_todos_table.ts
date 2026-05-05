import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Create todos table
  await db.schema
    .createTable('todos')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('user_id', 'text', col =>
      col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('title', 'varchar(255)', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('completed', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Create indexes
  await db.schema
    .createIndex('idx_todos_user_id')
    .on('todos')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_todos_completed')
    .on('todos')
    .column('completed')
    .execute()

  await db.schema
    .createIndex('idx_todos_created_at')
    .on('todos')
    .column('created_at')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('todos').execute()
}
