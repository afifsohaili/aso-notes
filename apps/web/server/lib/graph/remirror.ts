import type { GraphDb } from './age'
import { agLiteral, executeCypher } from './age'
import {
  mergeConceptNode,
  mergeGroupedUnderEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTopicNode,
} from './helpers'

export interface RemirrorCounts {
  concepts: number
  topics: number
  noteVertices: number
  mentions: number
  relations: number
  conceptTopics: number
}

/**
 * Deterministic AGE re-mirror for a single workspace.
 *
 * Authoritative graph state lives in the relational tables; Apache AGE is a
 * mirror. This routine makes AGE match the relational state for the five
 * graph tables (concepts, topics, concept_topics, relations, mentions) for
 * the given workspace:
 *
 * 1. Delete all Concept and Topic vertices (and their incident edges) scoped
 *    to the workspace. This clears RELATES_TO, GROUPED_UNDER and MENTIONS
 *    edges for the workspace without touching Note/Tag vertices or TAGGED/LINKS
 *    edges, which are outside the snapshot scope.
 * 2. Replay every relational row into AGE using the same MERGE conventions as
 *    store-graph.
 *
 * The routine is idempotent and safe to run repeatedly; it doubles as a
 * graph-repair tool independent of consolidation.
 */
export async function remirrorGraph(db: GraphDb, workspaceId: string): Promise<RemirrorCounts> {
  await clearWorkspaceGraph(db, workspaceId)

  const concepts = await db
    .selectFrom('concepts')
    .select(['id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const topics = await db
    .selectFrom('topics')
    .select(['id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const relations = await db
    .selectFrom('relations')
    .select(['from_concept_id', 'to_concept_id', 'type'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const conceptTopics = await db
    .selectFrom('concept_topics')
    .select(['concept_id', 'topic_id'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  // Mentions are stored per-chunk; AGE needs one MENTIONS edge per
  // Note → Concept pair, so collapse across chunks.
  const mentionRows = await db
    .selectFrom('mentions')
    .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
    .select(['chunks.note_id', 'mentions.concept_id'])
    .where('mentions.workspace_id', '=', workspaceId)
    .execute()

  const mentionPairs = new Map<string, { noteId: string, conceptId: string }>()
  for (const row of mentionRows) {
    const key = `${row.note_id}:${row.concept_id}`
    if (!mentionPairs.has(key))
      mentionPairs.set(key, { noteId: row.note_id, conceptId: row.concept_id })
  }

  for (const concept of concepts)
    await mergeConceptNode(db, { id: concept.id, workspaceId, name: concept.name })

  for (const topic of topics)
    await mergeTopicNode(db, { id: topic.id, workspaceId, name: topic.name })

  // Ensure Note vertices exist for every note that has mentions. Existing
  // Note vertices (possibly with TAGGED/LINKS edges) are left untouched.
  const noteIds = new Set<string>()
  for (const pair of mentionPairs.values()) {
    if (!noteIds.has(pair.noteId)) {
      noteIds.add(pair.noteId)
      await mergeNoteNode(db, { id: pair.noteId, workspaceId })
    }
  }

  for (const pair of mentionPairs.values())
    await mergeMentionsEdge(db, { noteId: pair.noteId, conceptId: pair.conceptId, workspaceId })

  for (const relation of relations) {
    await mergeRelatesToEdge(db, {
      fromId: relation.from_concept_id,
      toId: relation.to_concept_id,
      type: relation.type,
      workspaceId,
    })
  }

  for (const ct of conceptTopics) {
    await mergeGroupedUnderEdge(db, {
      conceptId: ct.concept_id,
      topicId: ct.topic_id,
      workspaceId,
    })
  }

  return {
    concepts: concepts.length,
    topics: topics.length,
    noteVertices: noteIds.size,
    mentions: mentionPairs.size,
    relations: relations.length,
    conceptTopics: conceptTopics.length,
  }
}

async function clearWorkspaceGraph(db: GraphDb, workspaceId: string): Promise<void> {
  await executeCypher(
    db,
    `MATCH (n:Concept {workspace_id: ${agLiteral(workspaceId)}}) DETACH DELETE n`,
  )
  await executeCypher(
    db,
    `MATCH (n:Topic {workspace_id: ${agLiteral(workspaceId)}}) DETACH DELETE n`,
  )
}
