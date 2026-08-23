import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('read_notifications')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('notification_id', 'integer', col =>
      col.notNull().references('notifications.id').onDelete('cascade'))
    .addColumn('user_id', 'text', col =>
      col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('read_at', 'timestamp', col => col.defaultTo(sql`now()`).notNull())
    .execute()

  // Create unique constraint
  await db.schema
    .createIndex('idx_read_notifications_unique')
    .on('read_notifications')
    .columns(['notification_id', 'user_id'])
    .unique()
    .execute()

  // Create indexes
  await db.schema
    .createIndex('idx_read_notifications_user')
    .on('read_notifications')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_read_notifications_notification')
    .on('read_notifications')
    .column('notification_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('read_notifications').execute()
}
