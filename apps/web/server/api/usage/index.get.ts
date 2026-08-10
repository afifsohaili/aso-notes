import { sql } from 'kysely'
import { useDatabase } from '~~/utils/db'
import { resolveWorkspaceId } from '../../utils/workspace'

interface RangeRow {
  generations: number
  tokens: number
  cost_usd: string
  usage_missing_count: number
}

interface GroupRow {
  llm_use_case: string
  model: string
  generations: number
  tokens: number
  cost_usd: string
  usage_missing_count: number
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

function toRangeRow(row: unknown): RangeResponse {
  const r = row as RangeRow
  return {
    generations: r.generations,
    tokens: r.tokens,
    costUsd: formatCost(r.cost_usd),
    usageMissingGenerations: r.usage_missing_count,
  }
}

interface RangeResponse {
  generations: number
  tokens: number
  costUsd: string
  usageMissingGenerations: number
}

interface GroupResponse {
  useCase: string
  model: string
  generations: number
  tokens: number
  costUsd: string
  usageMissingGenerations: number
}

function toGroupRow(row: unknown): GroupResponse {
  const r = row as GroupRow
  return {
    useCase: r.llm_use_case,
    model: r.model,
    generations: r.generations,
    tokens: r.tokens,
    costUsd: formatCost(r.cost_usd),
    usageMissingGenerations: r.usage_missing_count,
  }
}

function formatCost(costUsd: string): string {
  const n = Number.parseFloat(costUsd)
  return Number.isNaN(n) ? '0.000000' : n.toFixed(6)
}

function buildRangeQuery(db: any, workspaceId: string, start: Date) {
  return db
    .selectFrom('llm_generations')
    .select([
      sql<number>`count(*)::int`.as('generations'),
      sql<number>`coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0)::int`.as('tokens'),
      sql<string>`coalesce(sum(cost_usd), 0)::text`.as('cost_usd'),
      sql<number>`coalesce(sum(case when usage_missing then 1 else 0 end), 0)::int`.as('usage_missing_count'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', start)
}

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  }

  const start30d = daysAgo(30)

  const [todayRow, last7dRow, last30dRow, groups] = await Promise.all([
    buildRangeQuery(db, workspaceId, startOfToday()).executeTakeFirstOrThrow(),
    buildRangeQuery(db, workspaceId, daysAgo(7)).executeTakeFirstOrThrow(),
    buildRangeQuery(db, workspaceId, start30d).executeTakeFirstOrThrow(),
    db
      .selectFrom('llm_generations')
      .select([
        'llm_use_case',
        'model',
        sql<number>`count(*)::int`.as('generations'),
        sql<number>`coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0)::int`.as('tokens'),
        sql<string>`coalesce(sum(cost_usd), 0)::text`.as('cost_usd'),
        sql<number>`coalesce(sum(case when usage_missing then 1 else 0 end), 0)::int`.as('usage_missing_count'),
      ])
      .where('workspace_id', '=', workspaceId)
      .where('created_at', '>=', start30d)
      .groupBy(['llm_use_case', 'model'])
      .orderBy('llm_use_case', 'asc')
      .orderBy('model', 'asc')
      .execute() as unknown as GroupRow[],
  ])

  const mappedGroups = groups.map(toGroupRow)
  const total = mappedGroups.reduce((acc, row) => ({
    generations: acc.generations + row.generations,
    tokens: acc.tokens + row.tokens,
    costUsd: (Number.parseFloat(acc.costUsd) + Number.parseFloat(row.costUsd)).toFixed(6),
    usageMissingGenerations: acc.usageMissingGenerations + row.usageMissingGenerations,
  }), {
    generations: 0,
    tokens: 0,
    costUsd: '0.000000',
    usageMissingGenerations: 0,
  })

  return {
    ranges: {
      today: toRangeRow(todayRow),
      last7d: toRangeRow(last7dRow),
      last30d: toRangeRow(last30dRow),
    },
    groups: mappedGroups,
    total,
  }
})
