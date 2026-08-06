import type { EmbeddingProvider } from '../ai/types'
import type { ConsolidationDb, RewriteVerdict } from './types'
import { sql } from 'kysely'
import { reembedConcept } from './merge'

export async function executeRewriteConcept(
  db: ConsolidationDb,
  workspaceId: string,
  verdict: RewriteVerdict,
  runId: string,
  embeddingProvider?: EmbeddingProvider,
): Promise<void> {
  const concept = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'description'])
    .where('id', '=', verdict.id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirstOrThrow()

  const descriptionChanged = verdict.description && verdict.description !== concept.description
  if (descriptionChanged) {
    await db
      .updateTable('concepts')
      .set({ description: verdict.description, updated_at: sql`now()` })
      .where('id', '=', concept.id)
      .where('workspace_id', '=', workspaceId)
      .execute()
  }

  if (descriptionChanged && embeddingProvider) {
    await reembedConcept(db, embeddingProvider, workspaceId, concept.id, concept.name, verdict.description!)
  }

  await db
    .insertInto('consolidation_run_changes')
    .values({
      run_id: runId,
      action: 'rewrite',
      text: concept.name,
      reason: verdict.reason,
    })
    .execute()
}
