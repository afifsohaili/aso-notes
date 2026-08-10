import type { Kysely } from 'kysely'

/**
 * Phase 2 (plan-011) — add an explicit flag to llm_generations so the UI can
 * distinguish "provider did not report usage" from "usage was zero".
 *
 * The flag is set to true when a provider response omits token counts; cost is
 * still recorded separately when it is available (e.g. OpenRouter usage.cost).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('llm_generations')
    .addColumn('usage_missing', 'boolean', col => col.defaultTo(null))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('llm_generations')
    .dropColumn('usage_missing')
    .execute()
}
