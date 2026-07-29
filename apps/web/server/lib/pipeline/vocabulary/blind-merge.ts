import type { ExistingTopic, Vocabulary, VocabularyStrategy } from './types'

/**
 * Blind-merge vocabulary strategy: omit existing concepts from the prompt so
 * the LLM extracts freely. store-graph then merges by embedding similarity.
 * Tags and topics are still provided as vocabulary hints.
 */
export const blindMergeStrategy: VocabularyStrategy = {
  id: 'blind-merge',

  async loadVocabulary(db, workspaceId): Promise<Vocabulary> {
    const [tags, topics] = await Promise.all([
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
      concepts: [],
      tags: tags.map(t => t.name),
      topics,
    }
  },

  mergeOnStore: true,
}
