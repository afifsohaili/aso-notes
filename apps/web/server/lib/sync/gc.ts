import type { GraphDb } from '../graph/age'
import { agLiteral, executeCypher } from '../graph/age'

/**
 * Pure decision core for orphan GC after a synced folder's notes are removed.
 *
 * Concepts are removed when they have no remaining mentions. Relations touching
 * a removed concept are removed implicitly. Topics are removed when no remaining
 * concepts are linked to them.
 */
export interface OrphanGcInput {
  concepts: { id: string }[]
  mentions: { concept_id: string }[]
  relations: { id?: string, from_concept_id: string, to_concept_id: string }[]
  conceptTopics: { concept_id: string, topic_id: string }[]
}

export interface OrphanGcPlan {
  conceptIdsToRemove: string[]
  relationIdsToRemove: string[]
  topicIdsToRemove: string[]
}

export function planOrphanGc(input: OrphanGcInput): OrphanGcPlan {
  const mentionedConceptIds = new Set(input.mentions.map(m => m.concept_id))
  const conceptIdsToRemove = input.concepts
    .map(c => c.id)
    .filter(id => !mentionedConceptIds.has(id))
  const removedConceptSet = new Set(conceptIdsToRemove)

  const relationIdsToRemove = input.relations
    .filter(r => removedConceptSet.has(r.from_concept_id) || removedConceptSet.has(r.to_concept_id))
    .map(r => r.id)
    .filter((id): id is string => id !== undefined)

  const topicsWithLiveConcepts = new Set(
    input.conceptTopics
      .filter(ct => !removedConceptSet.has(ct.concept_id))
      .map(ct => ct.topic_id),
  )
  const topicIdsToRemove = [...new Set(input.conceptTopics.map(ct => ct.topic_id))]
    .filter(topicId => !topicsWithLiveConcepts.has(topicId))

  return { conceptIdsToRemove, relationIdsToRemove, topicIdsToRemove }
}

export interface SyncedFolderRemovalCounts {
  notes: number
  chunks: number
  mentions: number
  concepts: number
  relations: number
  topics: number
  links: number
  sources: number
  aiNoteTags: number
  userNoteTags: number
  tagDismissals: number
}

interface CountRow {
  c: bigint | number | string
}

function numberFromCount(row: CountRow): number {
  return Number(row.c ?? 0)
}

function cypherIdList(ids: string[]): string {
  return `[${ids.map(agLiteral).join(', ')}]`
}

/**
 * Remove a synced folder and garbage-collect derived rows that become orphaned.
 *
 * The caller is responsible for wrapping this in a transaction; the function
 * performs the operations on the supplied db handle.
 */
export async function removeSyncedFolderAndCollectGarbage(
  db: GraphDb,
  workspaceId: string,
  syncedFolderId: string,
): Promise<SyncedFolderRemovalCounts> {
  const notes = await db
    .selectFrom('notes')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('synced_folder_id', '=', syncedFolderId)
    .execute()

  const noteIds = notes.map(n => n.id)

  const [
    chunksRow,
    mentionsRow,
    linksRow,
    sourcesRow,
    aiNoteTagsRow,
    userNoteTagsRow,
    tagDismissalsRow,
  ] = await Promise.all([
    noteIds.length > 0
      ? db
          .selectFrom('chunks')
          .select(eb => eb.fn.count('id').as('c'))
          .where('note_id', 'in', noteIds)
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('mentions')
          .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
          .select(eb => eb.fn.count('mentions.id').as('c'))
          .where('chunks.note_id', 'in', noteIds)
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('links')
          .select(eb => eb.fn.count('id').as('c'))
          .where(eb => eb.or([
            eb('from_note_id', 'in', noteIds),
            eb('to_note_id', 'in', noteIds),
          ]))
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('sources')
          .select(eb => eb.fn.count('id').as('c'))
          .where('note_id', 'in', noteIds)
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('note_tags')
          .select(eb => eb.fn.count('tag_id').as('c'))
          .where('note_id', 'in', noteIds)
          .where('origin', '=', 'ai')
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('note_tags')
          .select(eb => eb.fn.count('tag_id').as('c'))
          .where('note_id', 'in', noteIds)
          .where('origin', '=', 'user')
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
    noteIds.length > 0
      ? db
          .selectFrom('note_tag_dismissals')
          .select(eb => eb.fn.count('tag_id').as('c'))
          .where('note_id', 'in', noteIds)
          .executeTakeFirstOrThrow()
      : Promise.resolve({ c: 0 } as CountRow),
  ])

  if (noteIds.length > 0) {
    await db
      .deleteFrom('notes')
      .where('id', 'in', noteIds)
      .execute()
  }

  // A note deletion cascades to chunks/mentions/links/sources/note_tags/dismissals.
  // Now garbage-collect concepts/topics whose only mentions were on those notes.
  const deadConcepts = await db
    .selectFrom('concepts')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', 'not in', eb => eb.selectFrom('mentions').select('concept_id').distinct())
    .execute()

  const conceptIdsToRemove = deadConcepts.map(c => c.id)

  const relationsRow = conceptIdsToRemove.length > 0
    ? await db
        .selectFrom('relations')
        .select(eb => eb.fn.count('id').as('c'))
        .where('workspace_id', '=', workspaceId)
        .where(eb => eb.or([
          eb('from_concept_id', 'in', conceptIdsToRemove),
          eb('to_concept_id', 'in', conceptIdsToRemove),
        ]))
        .executeTakeFirstOrThrow()
    : ({ c: 0 } as CountRow)

  if (conceptIdsToRemove.length > 0) {
    await db
      .deleteFrom('concepts')
      .where('id', 'in', conceptIdsToRemove)
      .execute()
  }

  const deadTopics = await db
    .selectFrom('topics')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', 'not in', eb => eb.selectFrom('concept_topics').select('topic_id').distinct())
    .execute()

  const topicIdsToRemove = deadTopics.map(t => t.id)

  if (topicIdsToRemove.length > 0) {
    await db
      .deleteFrom('topics')
      .where('id', 'in', topicIdsToRemove)
      .execute()
  }

  // Mirror the same deletions in the shared Apache AGE graph.
  if (noteIds.length > 0) {
    await executeCypher(
      db,
      `MATCH (n:Note) WHERE n.id IN ${cypherIdList(noteIds)} OPTIONAL MATCH (n)-[r]-() DELETE r, n`,
    )
  }

  if (conceptIdsToRemove.length > 0) {
    await executeCypher(
      db,
      `MATCH (c:Concept) WHERE c.id IN ${cypherIdList(conceptIdsToRemove)} OPTIONAL MATCH (c)-[r]-() DELETE r, c`,
    )
  }

  if (topicIdsToRemove.length > 0) {
    await executeCypher(
      db,
      `MATCH (t:Topic) WHERE t.id IN ${cypherIdList(topicIdsToRemove)} OPTIONAL MATCH (t)-[r]-() DELETE r, t`,
    )
  }

  await db
    .deleteFrom('synced_folders')
    .where('id', '=', syncedFolderId)
    .execute()

  return {
    notes: noteIds.length,
    chunks: numberFromCount(chunksRow),
    mentions: numberFromCount(mentionsRow),
    concepts: conceptIdsToRemove.length,
    relations: numberFromCount(relationsRow),
    topics: topicIdsToRemove.length,
    links: numberFromCount(linksRow),
    sources: numberFromCount(sourcesRow),
    aiNoteTags: numberFromCount(aiNoteTagsRow),
    userNoteTags: numberFromCount(userNoteTagsRow),
    tagDismissals: numberFromCount(tagDismissalsRow),
  }
}
