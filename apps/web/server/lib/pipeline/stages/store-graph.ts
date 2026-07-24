import type { EmbeddingProvider } from '../../ai/types'
import type { PipelineContext } from '../context'
import type { ExtractedLink, ExtractedSource, GraphExtraction, Stage } from '../types'
import { sql } from 'kysely'
import { EMBEDDING_DIMENSIONS } from '../../ai'
import {
  mergeConceptNode,
  mergeLinkEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  wipeNoteEdges,
} from '../../graph'
import { normalizeGraphName } from '../extraction'
import { STORE_GRAPH_STAGE } from '../ids'

const CONCEPT_EMBED_BATCH_SIZE = 100

const EMPTY_EXTRACTION: GraphExtraction = { concepts: [], relations: [], mentions: [], tags: [] }

/**
 * The AGE-mirror operations store-graph performs inside its transaction —
 * constructor-injectable so tests can exercise the atomicity guarantee
 * (a mirror failure must roll back every relational write).
 */
export interface GraphMirror {
  wipeNoteEdges: typeof wipeNoteEdges
  mergeNoteNode: typeof mergeNoteNode
  mergeConceptNode: typeof mergeConceptNode
  mergeRelatesToEdge: typeof mergeRelatesToEdge
  mergeMentionsEdge: typeof mergeMentionsEdge
  mergeTagNode: typeof mergeTagNode
  mergeTaggedEdge: typeof mergeTaggedEdge
  mergeLinkEdge: typeof mergeLinkEdge
}

const realGraphMirror: GraphMirror = {
  wipeNoteEdges,
  mergeNoteNode,
  mergeConceptNode,
  mergeRelatesToEdge,
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

/** `"name: description"` per plan §store-graph phase 2. */
function conceptEmbeddingInput(concept: { name: string, description: string }): string {
  return `${concept.name}: ${concept.description}`
}

async function embedNewConcepts(
  provider: EmbeddingProvider,
  concepts: { name: string, description: string }[],
): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let start = 0; start < concepts.length; start += CONCEPT_EMBED_BATCH_SIZE) {
    const batch = concepts.slice(start, start + CONCEPT_EMBED_BATCH_SIZE)
    const batchEmbeddings = await provider.embed(batch.map(conceptEmbeddingInput))
    if (batchEmbeddings.length !== batch.length) {
      throw new Error(
        `embedding provider returned ${batchEmbeddings.length} embeddings for ${batch.length} concept inputs`,
      )
    }
    for (const embedding of batchEmbeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `concept embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
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
    const seenNew = new Set<string>()
    for (const concept of extraction.concepts) {
      const normalized = normalizeGraphName(concept.name)
      if (!normalized || conceptByNormalized.has(normalized) || seenNew.has(normalized))
        continue
      seenNew.add(normalized)
      newConcepts.push({ name: concept.name, name_normalized: normalized, description: concept.description })
    }

    // --- phase 2: batch-embed new concepts (outside the transaction) -----
    const newEmbeddings = await embedNewConcepts(this.embeddingProvider, newConcepts)

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

      // (b) upsert concepts: insert new ones with embeddings; fill empty
      // descriptions on existing rows (never overwrite a non-empty one)
      for (let i = 0; i < newConcepts.length; i++) {
        const concept = newConcepts[i]!
        const inserted = await trx
          .insertInto('concepts')
          .values({
            workspace_id: workspaceId,
            name: concept.name,
            name_normalized: concept.name_normalized,
            description: concept.description || null,
            embedding: halfvecLiteral(newEmbeddings[i]!),
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
