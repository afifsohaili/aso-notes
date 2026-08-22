import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'

export interface ConsolidationUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

export async function computeConsolidationUsage(
  db: ConsolidationDb,
  runId: string,
): Promise<ConsolidationUsage | null> {
  const result = await db
    .selectFrom('llm_generations')
    .innerJoin('llm_traces', 'llm_traces.id', 'llm_generations.trace_id')
    .select([
      db.fn.sum('llm_generations.prompt_tokens').as('prompt_tokens'),
      db.fn.sum('llm_generations.completion_tokens').as('completion_tokens'),
    ])
    .where('llm_traces.owner_type', '=', 'consolidation_runs')
    .where('llm_traces.owner_id', '=', runId)
    .executeTakeFirst()

  if (!result)
    return null

  const promptTokens = Number(result.prompt_tokens ?? 0)
  const completionTokens = Number(result.completion_tokens ?? 0)
  if (promptTokens === 0 && completionTokens === 0)
    return null

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

export async function computeConsolidationUsageForRuns(
  db: ConsolidationDb,
  runIds: string[],
): Promise<Map<string, ConsolidationUsage>> {
  if (runIds.length === 0)
    return new Map()

  const rows = await db
    .selectFrom('llm_generations')
    .innerJoin('llm_traces', 'llm_traces.id', 'llm_generations.trace_id')
    .select([
      'llm_traces.owner_id as run_id',
      db.fn.sum('llm_generations.prompt_tokens').as('prompt_tokens'),
      db.fn.sum('llm_generations.completion_tokens').as('completion_tokens'),
    ])
    .where('llm_traces.owner_type', '=', 'consolidation_runs')
    .where('llm_traces.owner_id', 'in', runIds)
    .groupBy('llm_traces.owner_id')
    .execute()

  const usageByRun = new Map<string, ConsolidationUsage>()
  for (const row of rows) {
    const promptTokens = Number(row.prompt_tokens ?? 0)
    const completionTokens = Number(row.completion_tokens ?? 0)
    if (promptTokens > 0 || completionTokens > 0) {
      usageByRun.set(row.run_id, {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      })
    }
  }

  return usageByRun
}
