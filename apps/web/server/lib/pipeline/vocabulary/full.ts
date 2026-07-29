import type { ExistingConcept, ExistingTopic, Vocabulary, VocabularyStrategy } from './types'

/**
 * Full vocabulary strategy: inject every existing concept, tag, and topic into
 * the prompt. Backwards-compatible with pre-strategy extraction behavior.
 */
export const fullVocabularyStrategy: VocabularyStrategy = {
  id: 'full',

  async loadVocabulary(db, workspaceId): Promise<Vocabulary> {
    const [concepts, tags, topics] = await Promise.all([
      db
        .selectFrom('concepts')
        .select(['id', 'name', 'description'])
        .where('workspace_id', '=', workspaceId)
        .orderBy('name')
        .execute() as Promise<ExistingConcept[]>,
      db
        .selectFrom('tags')
        .select('name')
        .where('workspace_id', '=', workspaceId)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('topics')
        .select(['id', 'name', 'description'])
        .where('workspace_id', '=', workspaceId)
        .orderBy('name')
        .execute() as Promise<ExistingTopic[]>,
    ])

    return {
      concepts,
      tags: tags.map(t => t.name),
      topics,
    }
  },

  mergeOnStore: false,
}
