import type { Notifications } from '@monorepo/shared'
import { useDatabase } from '~~/utils/db'

export interface CreateNotificationData {
  title: string
  message: string
  type?: 'info' | 'warning' | 'success' | 'error'
  target_type: 'organization' | 'role'
  target_id?: string | null
  created_by: string
  is_active?: boolean
}

export interface AdminNotificationFilters {
  page?: number
  limit?: number | 'all'
  type?: 'info' | 'warning' | 'success' | 'error'
  target_type?: 'organization' | 'role'
  is_active?: boolean
  search?: string
}

export interface UserNotification extends Notifications {
  is_read: boolean
  read_at?: Date | null
}

export async function createNotification(data: CreateNotificationData) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  return await db
    .insertInto('notifications')
    .values({
      title: data.title,
      message: data.message,
      type: data.type || 'info',
      target_type: data.target_type,
      target_id: data.target_id,
      created_by: data.created_by,
      is_active: data.is_active ?? true,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getUserNotifications(userId: string, organizationId?: string, userRole?: string) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  const query = db
    .selectFrom('notifications as n')
    .leftJoin('read_notifications as rn', join =>
      join
        .onRef('rn.notification_id', '=', 'n.id')
        .on('rn.user_id', '=', userId))
    .select([
      'n.id',
      'n.title',
      'n.message',
      'n.type',
      'n.target_type',
      'n.target_id',
      'n.created_by',
      'n.created_at',
      'n.is_active',
      'rn.read_at',
      eb => eb
        .case()
        .when('rn.read_at', 'is not', null)
        .then(true)
        .else(false)
        .end()
        .as('is_read'),
    ])
    .where('n.is_active', '=', true)
    .where((eb) => {
      const conditions = []

      if (organizationId) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'organization'),
            eb('n.target_id', '=', organizationId),
          ]),
        )
      }

      if (userRole) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'role'),
            eb('n.target_id', '=', userRole),
          ]),
        )
      }

      return eb.or(conditions)
    })
    .orderBy('n.created_at', 'desc')

  const notifications = await query.execute()

  return notifications.map(n => ({
    ...n,
    is_read: Boolean(n.is_read),
    read_at: n.read_at || null,
  })) as UserNotification[]
}

export async function getUnreadNotificationCount(userId: string, organizationId?: string, userRole?: string) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  const query = db
    .selectFrom('notifications as n')
    .leftJoin('read_notifications as rn', join =>
      join
        .onRef('rn.notification_id', '=', 'n.id')
        .on('rn.user_id', '=', userId))
    .select(eb => eb.fn.countAll().as('count'))
    .where('n.is_active', '=', true)
    .where('rn.read_at', 'is', null)
    .where((eb) => {
      const conditions = []

      if (organizationId) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'organization'),
            eb('n.target_id', '=', organizationId),
          ]),
        )
      }

      if (userRole) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'role'),
            eb('n.target_id', '=', userRole),
          ]),
        )
      }

      return eb.or(conditions)
    })

  const result = await query.executeTakeFirst()
  return Number(result?.count || 0)
}

export async function markNotificationAsRead(notificationId: number, userId: string) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  await db
    .insertInto('read_notifications')
    .values({
      notification_id: notificationId,
      user_id: userId,
    })
    .onConflict(oc => oc.columns(['notification_id', 'user_id']).doNothing())
    .execute()
}

export async function markNotificationsAsRead(notificationIds: number[], userId: string) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  if (notificationIds.length === 0)
    return

  const values = notificationIds.map(id => ({
    notification_id: id,
    user_id: userId,
  }))

  await db
    .insertInto('read_notifications')
    .values(values)
    .onConflict(oc => oc.columns(['notification_id', 'user_id']).doNothing())
    .execute()
}

export async function markAllNotificationsAsRead(userId: string, organizationId?: string, userRole?: string) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  // First, get all unread notification IDs for this user
  const query = db
    .selectFrom('notifications as n')
    .leftJoin('read_notifications as rn', join =>
      join
        .onRef('rn.notification_id', '=', 'n.id')
        .on('rn.user_id', '=', userId))
    .select('n.id')
    .where('n.is_active', '=', true)
    .where('rn.read_at', 'is', null)
    .where((eb) => {
      const conditions = []

      if (organizationId) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'organization'),
            eb('n.target_id', '=', organizationId),
          ]),
        )
      }

      if (userRole) {
        conditions.push(
          eb.and([
            eb('n.target_type', '=', 'role'),
            eb('n.target_id', '=', userRole),
          ]),
        )
      }

      return eb.or(conditions)
    })

  const unreadNotifications = await query.execute()
  const notificationIds = unreadNotifications.map(n => n.id)

  if (notificationIds.length > 0)
    await markNotificationsAsRead(notificationIds, userId)
}

export async function getAdminNotifications(filters: AdminNotificationFilters = {}) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  let query = db
    .selectFrom('notifications as n')
    .leftJoin('users as u', 'u.id', 'n.created_by')
    .select([
      'n.id',
      'n.title',
      'n.message',
      'n.type',
      'n.target_type',
      'n.target_id',
      'n.created_by',
      'n.created_at',
      'n.is_active',
      'u.email as created_by_email',
    ])

  // Apply filters
  if (filters.type)
    query = query.where('n.type', '=', filters.type)

  if (filters.target_type)
    query = query.where('n.target_type', '=', filters.target_type)

  if (filters.is_active !== undefined)
    query = query.where('n.is_active', '=', filters.is_active)

  if (filters.search) {
    query = query.where(eb =>
      eb.or([
        eb('n.title', 'ilike', `%${filters.search}%`),
        eb('n.message', 'ilike', `%${filters.search}%`),
      ]),
    )
  }

  // Count total for pagination - create a separate query for counting
  let countQuery = db
    .selectFrom('notifications as n')
    .leftJoin('users as u', 'u.id', 'n.created_by')
    .select(eb => eb.fn.countAll().as('total'))

  // Apply the same filters to count query
  if (filters.type)
    countQuery = countQuery.where('n.type', '=', filters.type)

  if (filters.target_type)
    countQuery = countQuery.where('n.target_type', '=', filters.target_type)

  if (filters.is_active !== undefined)
    countQuery = countQuery.where('n.is_active', '=', filters.is_active)

  if (filters.search) {
    countQuery = countQuery.where(eb =>
      eb.or([
        eb('n.title', 'ilike', `%${filters.search}%`),
        eb('n.message', 'ilike', `%${filters.search}%`),
      ]),
    )
  }

  const totalResult = await countQuery.executeTakeFirst()
  const total = Number(totalResult?.total || 0)

  // Apply pagination if not 'all'
  if (filters.limit !== 'all') {
    const page = filters.page || 1
    const limit = filters.limit || 25
    const offset = (page - 1) * limit

    query = query.limit(limit).offset(offset)
  }

  // Order by created_at desc
  query = query.orderBy('n.created_at', 'desc')

  const notifications = await query.execute()

  // Return pagination only when not requesting all
  if (filters.limit === 'all') {
    return {
      notifications,
    }
  }

  return {
    notifications,
    pagination: {
      total,
      page: filters.page || 1,
      limit: filters.limit || 25,
    },
  }
}

export async function updateNotification(id: number, data: Partial<CreateNotificationData>) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  return await db
    .updateTable('notifications')
    .set({
      ...(data.title && { title: data.title }),
      ...(data.message && { message: data.message }),
      ...(data.type && { type: data.type }),
      ...(data.target_type && { target_type: data.target_type }),
      ...(data.target_id !== undefined && { target_id: data.target_id }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function deleteNotification(id: number) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  return await db
    .deleteFrom('notifications')
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getNotificationById(id: number) {
  const config = useRuntimeConfig()
  const db = useDatabase({ databaseUrl: config.databaseUrl })

  return await db
    .selectFrom('notifications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
}
