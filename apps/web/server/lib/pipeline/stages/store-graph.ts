import type { EmbeddingProvider } from '../../ai/types'
import type { PipelineContext } from '../context'
import type { ExtractedLink, ExtractedSource, GraphExtraction, Stage } from '../types'
import { sql } from 'kysely'
import { EMBEDDING_DIMENSIONS } from '../../ai'
import {
  mergeConceptNode,
  mergeGroupedUnderEdge,
  mergeLinkEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  mergeTopicNode,
  wipeNoteEdges,
} from '../../graph'
import { resolveBlindMergeThreshold } from '../../settings'
import { normalizeGraphName } from '../extraction'
import { STORE_GRAPH_STAGE } from '../ids'

const CONCEPT_EMBED_BATCH_SIZE = 100

const EMPTY_EXTRACTION: GraphExtraction = { topics: [], concepts: [], relations: [], mentions: [], tags: [] }

/**
 * The AGE-mirror operations store-graph performs inside its transaction —
 * constructor-injectable so tests can exercise the atomicity guarantee
 * (a mirror failure must roll back every relational write).
 */
export interface GraphMirror {
  wipeNoteEdges: typeof wipeNoteEdges
  mergeNoteNode: typeof mergeNoteNode
  mergeConceptNode: typeof mergeConceptNode
  mergeTopicNode: typeof mergeTopicNode
  mergeRelatesToEdge: typeof mergeRelatesToEdge
  mergeGroupedUnderEdge: typeof mergeGroupedUnderEdge
  mergeMentionsEdge: typeof mergeMentionsEdge
  mergeTagNode: typeof mergeTagNode
  mergeTaggedEdge: typeof mergeTaggedEdge
  mergeLinkEdge: typeof mergeLinkEdge
}

const realGraphMirror: GraphMirror = {
  wipeNoteEdges,
  mergeNoteNode,
  mergeConceptNode,
  mergeTopicNode,
  mergeRelatesToEdge,
  mergeGroupedUnderEdge,
  mergeMentionsEdge,
  mergeTagNode,
  mergeTaggedEdge,
  mergeLinkEdge,
}

interface ConceptRow {
  id: string
  name: string
  name_normalized: string
  description: string | null
}

interface TopicRow {
  id: string
  name: string
  name_normalized: string
  description: string | null
}

/** `"name: description"` per plan §store-graph phase 2. */
function graphItemEmbeddingInput(item: { name: string, description: string }): string {
  return `${item.name}: ${item.description}`
}

export function topicEmbeddingInput(topic: { name: string, description: string }): string {
  return graphItemEmbeddingInput(topic)
}

/**
 * Collect every topic name referenced by the extraction: note-level topics plus
 * per-concept topic refs. Dedupe by normalized name; note-level descriptions
 * win over empty per-concept refs.
 */
export function collectTopicNames(extraction: GraphExtraction): Map<string, { name: string, description: string }> {
  const names = new Map<string, { name: string, description: string }>()
  for (const topic of extraction.topics) {
    const normalized = normalizeGraphName(topic.name)
    if (!normalized || names.has(normalized))
      continue
    names.set(normalized, { name: topic.name, description: topic.description || '' })
  }
  for (const concept of extraction.concepts) {
    for (const topicName of concept.topics) {
      const normalized = normalizeGraphName(topicName)
      if (!normalized || names.has(normalized))
        continue
      names.set(normalized, { name: topicName, description: '' })
    }
  }
  return names
}

async function embedGraphItems(
  provider: EmbeddingProvider,
  items: { name: string, description: string }[],
): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let start = 0; start < items.length; start += CONCEPT_EMBED_BATCH_SIZE) {
    const batch = items.slice(start, start + CONCEPT_EMBED_BATCH_SIZE)
    const batchEmbeddings = await provider.embed(batch.map(graphItemEmbeddingInput))
    if (batchEmbeddings.length !== batch.length) {
      throw new Error(
        `embedding provider returned ${batchEmbeddings.length} embeddings for ${batch.length} item inputs`,
      )
    }
    for (const embedding of batchEmbeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `item embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        )
      }
    }
    embeddings.push(...batchEmbeddings)
  }
  return embeddings
}

function halfvecLiteral(embedding: number[]) {
  return sql`CAST(${`[${embedding.join(',')}]`} AS halfvec)`
}

/**
 * Final pipeline stage (plan §store-graph): the ONLY stage that persists.
 * Phase 1 resolves referenced concept names against existing workspace
 * concepts (read-only), phase 2 batch-embeds genuinely new concepts, and
 * phase 3 performs one transaction: wipe+rewrite note-derived rows, upsert
 * concepts, insert relations/mentions/ai-tags/links/sources, mirror the
 * subgraph into AGE, and mark the note ingested. Any failure rolls back the
 * whole transaction — nothing persists partially.
 */
export class StoreGraphStage implements Stage {
  readonly id = STORE_GRAPH_STAGE

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly mirror: GraphMirror = realGraphMirror,
  ) {}

  async invoke(ctx: PipelineContext): Promise<void> {
    const extraction = ctx.extraction ?? EMPTY_EXTRACTION
    const chunks = ctx.chunks ?? []
    const links = ctx.getOutput<ExtractedLink[]>('links') ?? []
    const sources = ctx.getOutput<ExtractedSource[]>('sources') ?? []
    const noteId = ctx.note.id
    const workspaceId = ctx.workspaceId

    // --- phase 1: read-only concept resolution ---------------------------
    // Names referenced anywhere (concepts, relation endpoints, mentions)
    // resolve against existing workspace concepts by name_normalized.
    const referencedNames = new Set<string>()
    for (const concept of extraction.concepts)
      referencedNames.add(normalizeGraphName(concept.name))
    for (const relation of extraction.relations) {
      referencedNames.add(normalizeGraphName(relation.from))
      referencedNames.add(normalizeGraphName(relation.to))
    }
    for (const mention of extraction.mentions)
      referencedNames.add(normalizeGraphName(mention.concept))
    referencedNames.delete('')

    const existingConcepts: ConceptRow[] = referencedNames.size > 0
      ? await ctx.db
          .selectFrom('concepts')
          .select(['id', 'name', 'name_normalized', 'description'])
          .where('workspace_id', '=', workspaceId)
          .where('name_normalized', 'in', [...referencedNames])
          .execute()
      : []
    const conceptByNormalized = new Map(existingConcepts.map(c => [c.name_normalized, c]))

    // New concepts: extraction entries (deduped by normalized name) that
    // don't resolve to an existing row.
    const newConcepts: { name: string, name_normalized: string, description: string }[] = []
    const seenNewConcept = new Set<string>()
    for (const concept of extraction.concepts) {
      const normalized = normalizeGraphName(concept.name)
      if (!normalized || conceptByNormalized.has(normalized) || seenNewConcept.has(normalized))
        continue
      seenNewConcept.add(normalized)
      newConcepts.push({ name: concept.name, name_normalized: normalized, description: concept.description })
    }

    // --- phase 1b: read-only topic resolution ----------------------------
    // Topics are LLM-assigned at the note level and linked to concepts via
    // concept_topics. Same normalized-name dedup discipline as concepts.
    const topicNames = collectTopicNames(extraction)
    const existingTopics: TopicRow[] = topicNames.size > 0
      ? await ctx.db
          .selectFrom('topics')
          .select(['id', 'name', 'name_normalized', 'description'])
          .where('workspace_id', '=', workspaceId)
          .where('name_normalized', 'in', [...topicNames.keys()])
          .execute()
      : []
    const topicByNormalized = new Map(existingTopics.map(t => [t.name_normalized, t]))

    const newTopics = [...topicNames.entries()]
      .filter(([normalized]) => !topicByNormalized.has(normalized))
      .map(([normalized, { name, description }]) => ({ name, name_normalized: normalized, description }))

    // --- phase 2: batch-embed new concepts and topics (outside tx) ------
    const [newConceptEmbeddings, newTopicEmbeddings] = await Promise.all([
      embedGraphItems(this.embeddingProvider, newConcepts),
      embedGraphItems(this.embeddingProvider, newTopics),
    ])

    // --- phase 3: the single final transaction ---------------------------
    // When the caller already runs inside a transaction (e2e harness,
    // composed flows), join it — the caller's transaction provides the
    // atomicity. Otherwise open the transaction here (production worker).
    const persist = async (trx: PipelineDb): Promise<void> => {
      // (a) wipe note-derived rows (mentions cascade via chunks)
      await trx.deleteFrom('chunks').where('note_id', '=', noteId).execute()
      await trx.deleteFrom('note_tags').where('note_id', '=', noteId).where('origin', '=', 'ai').execute()
      await trx.deleteFrom('links').where('from_note_id', '=', noteId).execute()
      await trx.deleteFrom('sources').where('note_id', '=', noteId).execute()

      // (h1) wipe this note's previous AGE edges; re-merge the Note node
      await this.mirror.wipeNoteEdges(trx, noteId)
      await this.mirror.mergeNoteNode(trx, { id: noteId, workspaceId })

      // (t1) upsert topics: insert new ones with embeddings; fill empty
      // descriptions on existing rows (never overwrite a non-empty one)
      for (let i = 0; i < newTopics.length; i++) {
        const topic = newTopics[i]!
        const inserted = await trx
          .insertInto('topics')
          .values({
            workspace_id: workspaceId,
            name: topic.name,
            name_normalized: topic.name_normalized,
            description: topic.description || null,
            embedding: halfvecLiteral(newTopicEmbeddings[i]!),
          })
          .returning(['id', 'name', 'name_normalized', 'description'])
          .executeTakeFirstOrThrow()
        topicByNormalized.set(topic.name_normalized, inserted)
      }
      for (const topic of extraction.topics) {
        const normalized = normalizeGraphName(topic.name)
        const existing = topicByNormalized.get(normalized)
        if (existing && !existing.description && topic.description) {
          await trx
            .updateTable('topics')
            .set({ description: topic.description, updated_at: sql`now()` })
            .where('id', '=', existing.id)
            .execute()
          existing.description = topic.description
        }
      }

      // mirror every referenced topic node into AGE
      for (const normalized of topicNames.keys()) {
        const topic = topicByNormalized.get(normalized)
        if (topic)
          await this.mirror.mergeTopicNode(trx, { id: topic.id, workspaceId, name: topic.name })
      }

      // (c) blind-merge pass: when the active strategy says so, try to match
      // each new concept to the nearest existing concept by embedding cosine
      // similarity before inserting it as a new row.
      if (ctx.vocabularyStrategy?.mergeOnStore) {
        const threshold = await resolveBlindMergeThreshold(trx, workspaceId)
        for (let i = 0; i < newConcepts.length; i++) {
          const concept = newConcepts[i]!
          // Only run for names that were not already resolved by exact match.
          if (conceptByNormalized.has(concept.name_normalized))
            continue
          const nearest = await trx
            .selectFrom('concepts')
            .select(['id', 'name', 'name_normalized', 'description', sql<number>`embedding <=> ${halfvecLiteral(newConceptEmbeddings[i]!)}`.as('distance')])
            .where('workspace_id', '=', workspaceId)
            .where('embedding', 'is not', null)
            .orderBy('distance')
            .limit(1)
            .executeTakeFirst()
          if (!nearest)
            continue
          const score = 1 - nearest.distance
          if (score >= threshold) {
            console.warn('blind-merge: merged concept', { newName: concept.name, existingName: nearest.name, score })
            conceptByNormalized.set(concept.name_normalized, nearest)
          }
        }
      }

      // (b) upsert concepts: insert remaining new ones with embeddings; fill
      // empty descriptions on existing rows (never overwrite a non-empty one)
      for (let i = 0; i < newConcepts.length; i++) {
        const concept = newConcepts[i]!
        const existing = conceptByNormalized.get(concept.name_normalized)
        // If we already mapped this name to an existing row via blind-merge,
        // skip the insert and reuse that row.
        if (existing && existing.name_normalized !== concept.name_normalized)
          continue
        const inserted = await trx
          .insertInto('concepts')
          .values({
            workspace_id: workspaceId,
            name: concept.name,
            name_normalized: concept.name_normalized,
            description: concept.description || null,
            embedding: halfvecLiteral(newConceptEmbeddings[i]!),
          })
          .returning(['id', 'name', 'name_normalized', 'description'])
          .executeTakeFirstOrThrow()
        conceptByNormalized.set(concept.name_normalized, inserted)
      }
      for (const concept of extraction.concepts) {
        const normalized = normalizeGraphName(concept.name)
        const existing = conceptByNormalized.get(normalized)
        if (existing && !existing.description && concept.description) {
          await trx
            .updateTable('concepts')
            .set({ description: concept.description, updated_at: sql`now()` })
            .where('id', '=', existing.id)
            .execute()
          existing.description = concept.description
        }
      }

      // mirror every referenced concept node into AGE
      for (const normalized of referencedNames) {
        const concept = conceptByNormalized.get(normalized)
        if (concept)
          await this.mirror.mergeConceptNode(trx, { id: concept.id, workspaceId, name: concept.name })
      }

      // (d) relations: resolve endpoints, insert-if-absent, mirror to AGE
      for (const relation of extraction.relations) {
        const from = conceptByNormalized.get(normalizeGraphName(relation.from))
        const to = conceptByNormalized.get(normalizeGraphName(relation.to))
        if (!from || !to) {
          console.warn(`store-graph: dropping relation with unknown endpoint (${relation.from} -> ${relation.to})`)
          continue
        }
        const existing = await trx
          .selectFrom('relations')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('from_concept_id', '=', from.id)
          .where('to_concept_id', '=', to.id)
          .where('type', '=', relation.type)
          .executeTakeFirst()
        if (!existing) {
          await trx
            .insertInto('relations')
            .values({
              workspace_id: workspaceId,
              from_concept_id: from.id,
              to_concept_id: to.id,
              type: relation.type,
              description: relation.description ?? null,
            })
            .execute()
        }
        await this.mirror.mergeRelatesToEdge(trx, { fromId: from.id, toId: to.id, type: relation.type, workspaceId })
      }

      // (a2) rewrite chunks with embeddings
      const insertedChunks = chunks.length > 0
        ? await trx
            .insertInto('chunks')
            .values(chunks.map(chunk => ({
              workspace_id: workspaceId,
              note_id: noteId,
              seq: chunk.index,
              text: chunk.text,
              token_count: chunk.tokenCount,
              embedding: chunk.embedding ? halfvecLiteral(chunk.embedding) : null,
            })))
            .returning(['id', 'seq'])
            .execute()
        : []
      const chunkIdBySeq = new Map(insertedChunks.map(c => [c.seq, c.id]))

      // (e) mentions: resolve concept + chunk, dedupe the pair
      const mentionPairs = new Map<string, { chunk_id: string, concept_id: string }>()
      for (const mention of extraction.mentions) {
        const concept = conceptByNormalized.get(normalizeGraphName(mention.concept))
        if (!concept) {
          console.warn(`store-graph: dropping mention of unknown concept '${mention.concept}'`)
          continue
        }
        for (const ref of mention.chunkRefs) {
          const chunkId = chunkIdBySeq.get(ref)
          if (!chunkId)
            continue
          mentionPairs.set(`${chunkId}:${concept.id}`, { chunk_id: chunkId, concept_id: concept.id })
        }
      }
      if (mentionPairs.size > 0) {
        await trx
          .insertInto('mentions')
          .values([...mentionPairs.values()].map(pair => ({ workspace_id: workspaceId, ...pair })))
          .execute()
      }
      const mentionedConceptIds = new Set([...mentionPairs.values()].map(p => p.concept_id))
      for (const conceptId of mentionedConceptIds)
        await this.mirror.mergeMentionsEdge(trx, { noteId, conceptId, workspaceId })

      // (t2) concept_topics: link each resolved concept to its assigned
      // topics, workspace-scoped. Unknown topic names are dropped with a warning.
      const conceptTopicPairs = new Map<string, { concept_id: string, topic_id: string }>()
      for (const concept of extraction.concepts) {
        const conceptRow = conceptByNormalized.get(normalizeGraphName(concept.name))
        if (!conceptRow)
          continue
        for (const topicName of concept.topics) {
          const topicRow = topicByNormalized.get(normalizeGraphName(topicName))
          if (!topicRow) {
            console.warn(`store-graph: dropping concept-topic link to unknown topic '${topicName}'`)
            continue
          }
          conceptTopicPairs.set(`${conceptRow.id}:${topicRow.id}`, { concept_id: conceptRow.id, topic_id: topicRow.id })
        }
      }
      if (conceptTopicPairs.size > 0) {
        await trx
          .insertInto('concept_topics')
          .values([...conceptTopicPairs.values()].map(pair => ({ workspace_id: workspaceId, ...pair })))
          .onConflict(oc => oc.columns(['concept_id', 'topic_id']).doNothing())
          .execute()
      }
      for (const pair of conceptTopicPairs.values())
        await this.mirror.mergeGroupedUnderEdge(trx, { conceptId: pair.concept_id, topicId: pair.topic_id, workspaceId })

      // (f) suggested ai tags: create tag rows as needed, respect
      // dismissals, never touch user-origin rows
      const suggestedTags = new Map<string, string>()
      for (const tag of extraction.tags) {
        const normalized = normalizeGraphName(tag)
        if (normalized && !suggestedTags.has(normalized))
          suggestedTags.set(normalized, tag)
      }
      for (const [normalized, displayName] of suggestedTags) {
        let tag = await trx
          .selectFrom('tags')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('name_normalized', '=', normalized)
          .executeTakeFirst()
        tag ??= await trx
          .insertInto('tags')
          .values({ workspace_id: workspaceId, name: displayName, name_normalized: normalized })
          .returning('id')
          .executeTakeFirstOrThrow()

        const dismissed = await trx
          .selectFrom('note_tag_dismissals')
          .select('tag_id')
          .where('note_id', '=', noteId)
          .where('tag_id', '=', tag.id)
          .executeTakeFirst()
        if (dismissed)
          continue

        const existingRow = await trx
          .selectFrom('note_tags')
          .select('tag_id')
          .where('note_id', '=', noteId)
          .where('tag_id', '=', tag.id)
          .executeTakeFirst()
        if (existingRow)
          continue // user-origin (unique(note_id, tag_id) would reject a second row)

        await trx
          .insertInto('note_tags')
          .values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'ai' })
          .execute()
      }

      // mirror the note's full current tag set (user + ai) into AGE
      const currentNoteTags = await trx
        .selectFrom('note_tags')
        .innerJoin('tags', 'tags.id', 'note_tags.tag_id')
        .select(['tags.id', 'tags.name'])
        .where('note_tags.note_id', '=', noteId)
        .execute()
      for (const tag of currentNoteTags) {
        await this.mirror.mergeTagNode(trx, { id: tag.id, workspaceId, name: tag.name })
        await this.mirror.mergeTaggedEdge(trx, { noteId, tagId: tag.id, workspaceId })
      }

      // (g) links + sources
      if (links.length > 0) {
        await trx
          .insertInto('links')
          .values(links.map(link => ({
            workspace_id: workspaceId,
            from_note_id: noteId,
            to_note_id: link.toNoteId,
            raw_target: link.rawTarget,
          })))
          .execute()
      }
      for (const link of links) {
        if (link.toNoteId) {
          // Ensure the target Note vertex exists before creating the edge.
          await this.mirror.mergeNoteNode(trx, { id: link.toNoteId, workspaceId })
          await this.mirror.mergeLinkEdge(trx, { fromNoteId: noteId, toNoteId: link.toNoteId, workspaceId })
        }
      }

      if (sources.length > 0) {
        await trx
          .insertInto('sources')
          .values(sources.map(source => ({
            workspace_id: workspaceId,
            note_id: noteId,
            url: source.url,
            url_normalized: source.urlNormalized,
            type: source.type,
          })))
          .execute()
      }

      // (i) mark the note ingested — moved here from the M3 worker so the
      // status flip shares the atomic transaction
      await trx
        .updateTable('notes')
        .set({ status: 'ingested', ingested_hash: ctx.note.content_hash, updated_at: sql`now()` })
        .where('id', '=', noteId)
        .execute()
    }

    if (ctx.db.isTransaction) {
      // Already inside a host transaction (e2e harness, composed flows):
      // a savepoint gives the same all-or-nothing guarantee without
      // poisoning the host transaction on failure.
      await sql`SAVEPOINT store_graph`.execute(ctx.db)
      try {
        await persist(ctx.db)
      }
      catch (error) {
        await sql`ROLLBACK TO SAVEPOINT store_graph`.execute(ctx.db)
        throw error
      }
    }
    else {
      await ctx.db.transaction().execute(persist)
    }
  }
}
