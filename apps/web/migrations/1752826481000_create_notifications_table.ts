import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('notifications')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('title', 'varchar(255)', col => col.notNull())
    .addColumn('message', 'text', col => col.notNull())
    .addColumn('type', 'varchar(50)', col => col.defaultTo('info').notNull())
    .addColumn('target_type', 'varchar(50)', col => col.notNull())
    .addColumn('target_id', 'text')
    .addColumn('created_by', 'text', col => col.notNull().references('users.id'))
    .addColumn('created_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .addColumn('is_active', 'boolean', col => col.defaultTo(true).notNull())
    .execute()

  // Create indexes
  await db.schema
    .createIndex('idx_notifications_target')
    .on('notifications')
    .columns(['target_type', 'target_id'])
    .execute()

  await db.schema
    .createIndex('idx_notifications_active')
    .on('notifications')
    .column('is_active')
    .execute()

  await db.schema
    .createIndex('idx_notifications_created_at')
    .on('notifications')
    .column('created_at')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('notifications').execute()
}
