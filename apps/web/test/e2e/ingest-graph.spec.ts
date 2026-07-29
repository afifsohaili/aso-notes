import type { CompletionRequest, EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import type { GraphMirror } from '../../server/lib/pipeline/stages/store-graph'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import {
  conceptNeighbors,
  mergeConceptNode,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  parseAgtype,
  queryCypher,
  wipeNoteEdges,
} from '../../server/lib/graph'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { createStageRegistry } from '../../server/lib/pipeline/singleton'
import { StoreGraphStage } from '../../server/lib/pipeline/stages/store-graph'
import { ingestNote } from '../../server/lib/sync/ingest'
import { ensureNotesGraphCatalog } from './age-catalog'

/**
 * M4 feature spec: full ingestion pipeline (extract-graph → extract-links →
 * extract-sources → store-graph) against a real Postgres + Apache AGE, with
 * stubbed LLM/embedding providers returning deterministic canned output.
 * The seam under test is the ingestion worker handler (ingestNote), which is
 * what the BullMQ worker calls.
 */

const NOTE_CONTENT = [
  '# Alpha section',
  '',
  `See [[/proj/target.md]] and [[ghost-note]]. ${'alpha '.repeat(180)}`,
  '',
  '# Beta section',
  '',
  `Watch https://www.youtube.com/watch?v=abc123 ${'beta '.repeat(180)}`,
].join('\n')

const EXTRACTION = {
  concepts: [
    { name: 'Graph RAG', description: 'retrieval over a knowledge graph', topics: ['Engineering'] },
    { name: 'Kysely', description: 'type-safe SQL builder', topics: ['Engineering'] },
  ],
  relations: [{ from: 'Graph RAG', to: 'Kysely', type: 'implemented-with' }],
  mentions: [
    { concept: 'Graph RAG', chunkRefs: [0] },
    { concept: 'Kysely', chunkRefs: [1] },
  ],
  tags: ['databases'],
  topics: [{ name: 'Engineering', description: 'software engineering topics' }],
}

function stubEmbeddingProvider() {
  const calls: string[][] = []
  const provider: EmbeddingProvider = {
    async embed(texts) {
      calls.push(texts)
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01))
    },
  }
  return { calls, provider }
}

function stubLLM(payload: object) {
  const requests: CompletionRequest[] = []
  const provider: LLMProvider = {
    async complete(request) {
      requests.push(request)
      return { message: { role: 'assistant', content: JSON.stringify(payload) } }
    },
  }
  return { provider, requests }
}

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, content: string) {
  return trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content,
      content_hash: `hash-${path}`,
      pipeline: 'markdown-note-with-links',
    })
    .returning(['id', 'content_hash'])
    .executeTakeFirstOrThrow()
}

async function ingest(trx: any, noteId: string, extraction: object) {
  const embedding = stubEmbeddingProvider()
  const llm = stubLLM(extraction)
  const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider: embedding.provider })
  await ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES } })
  return { embeddingCalls: embedding.calls, llmRequests: llm.requests }
}

async function rowCount(trx: any, table: string, where?: (q: any) => any): Promise<number> {
  let q = trx.selectFrom(table).select(sql<number>`count(*)::int`.as('c'))
  if (where)
    q = where(q)
  const row = await q.executeTakeFirstOrThrow()
  return row.c
}

async function cypherStrings(trx: any, query: string, column: string): Promise<string[]> {
  const rows = await queryCypher<Record<string, unknown>>(trx, query, `${column} ag_catalog.agtype`)
  return rows.map(row => String(parseAgtype(row[column])))
}

describe('m4 ingestion: extraction + store-graph + AGE mirror', () => {
  test('persists chunks, concepts, relations, mentions, tags, links, sources and marks the note ingested', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-full')
    await ensureNotesGraphCatalog(trx)
    const target = await givenNote(trx, workspaceId, '/proj/target.md', '# target')
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    await ingest(trx, note.id, EXTRACTION)

    // chunks: wiped + rewritten, embedded
    const chunks = await trx
      .selectFrom('chunks')
      .select(['seq', 'embedding', 'token_count'])
      .where('note_id', '=', note.id)
      .orderBy('seq')
      .execute()
    expect(chunks.map(c => c.seq)).toEqual([0, 1])
    expect(chunks.every(c => c.embedding !== null)).toBe(true)
    expect(chunks.every(c => (c.token_count ?? 0) > 0)).toBe(true)

    // concepts: upserted with normalized names + embeddings
    const concepts = await trx
      .selectFrom('concepts')
      .select(['id', 'name', 'name_normalized', 'description', 'embedding'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('name_normalized')
      .execute()
    expect(concepts.map(c => c.name_normalized)).toEqual(['graph rag', 'kysely'])
    expect(concepts.every(c => c.embedding !== null && c.description)).toBe(true)
    const conceptIdByName = new Map(concepts.map(c => [c.name, c.id]))

    // relations: resolved from/to concept ids
    const relations = await trx
      .selectFrom('relations')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute()
    expect(relations).toHaveLength(1)
    expect(relations[0]!.from_concept_id).toBe(conceptIdByName.get('Graph RAG'))
    expect(relations[0]!.to_concept_id).toBe(conceptIdByName.get('Kysely'))
    expect(relations[0]!.type).toBe('implemented-with')

    // mentions: linked to the correct chunk rows
    const mentions = await trx
      .selectFrom('mentions')
      .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
      .select(['mentions.concept_id', 'chunks.seq'])
      .where('chunks.note_id', '=', note.id)
      .execute()
    expect(mentions).toHaveLength(2)
    expect(mentions.find(m => m.concept_id === conceptIdByName.get('Graph RAG'))!.seq).toBe(0)
    expect(mentions.find(m => m.concept_id === conceptIdByName.get('Kysely'))!.seq).toBe(1)

    // tags: suggested ai tag created + attached
    const tag = await trx
      .selectFrom('tags')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'databases')
      .executeTakeFirstOrThrow()
    const noteTags = await trx
      .selectFrom('note_tags')
      .selectAll()
      .where('note_id', '=', note.id)
      .execute()
    expect(noteTags).toEqual([
      expect.objectContaining({ tag_id: tag.id, origin: 'ai' }),
    ])

    // links: resolved by path, dangling keeps raw_target
    const links = await trx
      .selectFrom('links')
      .selectAll()
      .where('from_note_id', '=', note.id)
      .execute()
    expect(links).toHaveLength(2)
    const resolved = links.find(l => l.to_note_id !== null)!
    expect(resolved.to_note_id).toBe(target.id)
    expect(resolved.raw_target).toBe('/proj/target.md')
    const dangling = links.find(l => l.to_note_id === null)!
    expect(dangling.raw_target).toBe('ghost-note')

    // sources: extracted + normalized
    const sources = await trx
      .selectFrom('sources')
      .selectAll()
      .where('note_id', '=', note.id)
      .execute()
    expect(sources).toEqual([
      expect.objectContaining({ url_normalized: 'youtube.com/watch?v=abc123', type: 'youtube' }),
    ])

    // note row: ingested with ingested_hash = content_hash (written inside the transaction)
    const after = await trx
      .selectFrom('notes')
      .select(['status', 'ingested_hash'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('ingested')
    expect(after.ingested_hash).toBe(note.content_hash)
  })

  test('mirrors nodes and edges into AGE in the same run', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-age')
    await ensureNotesGraphCatalog(trx)
    const target = await givenNote(trx, workspaceId, '/proj/target.md', '# target')
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    await ingest(trx, note.id, EXTRACTION)

    const mentioned = await cypherStrings(
      trx,
      `MATCH (n:Note {id: '${note.id}'})-[:MENTIONS]->(c:Concept) RETURN c.name ORDER BY c.name`,
      'name',
    )
    expect(mentioned).toEqual(['Graph RAG', 'Kysely'])

    const tagged = await cypherStrings(
      trx,
      `MATCH (n:Note {id: '${note.id}'})-[:TAGGED]->(t:Tag) RETURN t.name`,
      'name',
    )
    expect(tagged).toEqual(['databases'])

    const relTypes = await cypherStrings(
      trx,
      `MATCH (a:Concept {name: 'Graph RAG'})-[r:RELATES_TO]->(b:Concept {name: 'Kysely'}) RETURN r.type`,
      'type',
    )
    expect(relTypes).toEqual(['implemented-with'])

    const linked = await cypherStrings(
      trx,
      `MATCH (a:Note {id: '${note.id}'})-[:LINKS]->(b:Note) RETURN b.id`,
      'id',
    )
    expect(linked).toEqual([target.id])

    // workspace scoping lands on mirrored nodes
    const ws = await cypherStrings(
      trx,
      `MATCH (c:Concept {name: 'Kysely'}) RETURN c.workspace_id`,
      'workspace_id',
    )
    expect(ws).toEqual([workspaceId])

    // neighbor lookup helper (what M5's get_concept_neighbors tool will use)
    const kysely = await trx
      .selectFrom('concepts')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'kysely')
      .executeTakeFirstOrThrow()
    const neighbors = await conceptNeighbors(trx, { conceptId: kysely.id, workspaceId })
    expect(neighbors).toEqual([
      expect.objectContaining({ name: 'Graph RAG', distance: 1 }),
    ])
  })

  test('dedupes concepts by normalized name across notes; only new concepts get embedded', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-dedup')
    await ensureNotesGraphCatalog(trx)
    const first = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)
    const second = await givenNote(trx, workspaceId, '/proj/second.md', `# Second\n\n${'gamma '.repeat(180)}`)

    await ingest(trx, first.id, EXTRACTION)
    const secondRun = await ingest(trx, second.id, {
      concepts: [
        { name: 'graph  RAG!', description: 'a different description', topics: ['Engineering'] },
        { name: 'Postgres', description: 'the database', topics: ['Engineering'] },
      ],
      relations: [],
      mentions: [{ concept: 'Graph RAG', chunkRefs: [0] }],
      tags: [],
      topics: [],
    })

    // concept reused despite different spelling; description NOT overwritten
    const graphRag = await trx
      .selectFrom('concepts')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'graph rag')
      .execute()
    expect(graphRag).toHaveLength(1)
    expect(graphRag[0]!.description).toBe('retrieval over a knowledge graph')
    expect(await rowCount(trx, 'concepts')).toBe(3)

    // second run embedded only the genuinely new concept
    const embeddedTexts = secondRun.embeddingCalls.flat()
    expect(embeddedTexts.some(t => t.startsWith('Postgres:'))).toBe(true)
    expect(embeddedTexts.some(t => t.startsWith('graph  RAG!:'))).toBe(false)

    // both notes MENTION the same single AGE concept node
    const countRows = await queryCypher<{ c: unknown }>(
      trx,
      `MATCH (:Note)-[r:MENTIONS]->(c:Concept {name: 'Graph RAG'}) RETURN count(r)`,
      'c ag_catalog.agtype',
    )
    expect(Number(countRows[0]!.c)).toBe(2)
  })

  test('re-ingestion wipes and rewrites note-derived rows and AGE edges, preserving user tags and dismissals', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-reingest')
    await ensureNotesGraphCatalog(trx)
    await givenNote(trx, workspaceId, '/proj/target.md', '# target')
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    await ingest(trx, note.id, EXTRACTION)

    // user adds their own tag
    const userTag = await trx
      .insertInto('tags')
      .values({ workspace_id: workspaceId, name: 'user-tag', name_normalized: 'user-tag' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('note_tags')
      .values({ workspace_id: workspaceId, note_id: note.id, tag_id: userTag.id, origin: 'user' })
      .execute()

    // user dismisses the ai 'databases' tag
    const aiTag = await trx
      .selectFrom('tags')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'databases')
      .executeTakeFirstOrThrow()
    await trx
      .deleteFrom('note_tags')
      .where('note_id', '=', note.id)
      .where('tag_id', '=', aiTag.id)
      .execute()
    await trx
      .insertInto('note_tag_dismissals')
      .values({ workspace_id: workspaceId, note_id: note.id, tag_id: aiTag.id })
      .execute()

    // re-ingest with a changed extraction that re-suggests the dismissed tag
    await ingest(trx, note.id, {
      concepts: [
        { name: 'Graph RAG', description: 'retrieval over a knowledge graph', topics: ['Engineering'] },
        { name: 'Postgres', description: 'the database', topics: ['Engineering'] },
      ],
      relations: [],
      mentions: [{ concept: 'Postgres', chunkRefs: [1] }],
      tags: ['databases', 'search'],
      topics: [],
    })

    // no duplicate note-derived rows
    expect(await rowCount(trx, 'chunks', (q: any) => q.where('note_id', '=', note.id))).toBe(2)
    expect(await rowCount(trx, 'links', (q: any) => q.where('from_note_id', '=', note.id))).toBe(2)
    expect(await rowCount(trx, 'sources', (q: any) => q.where('note_id', '=', note.id))).toBe(1)

    // mentions rewritten: only Postgres remains, on chunk 1
    const mentions = await trx
      .selectFrom('mentions')
      .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
      .innerJoin('concepts', 'concepts.id', 'mentions.concept_id')
      .select(['concepts.name', 'chunks.seq'])
      .where('chunks.note_id', '=', note.id)
      .execute()
    expect(mentions).toEqual([{ name: 'Postgres', seq: 1 }])

    // tags: user tag preserved, dismissed tag blocked, new ai tag added
    const noteTags = await trx
      .selectFrom('note_tags')
      .innerJoin('tags', 'tags.id', 'note_tags.tag_id')
      .select(['tags.name', 'note_tags.origin'])
      .where('note_tags.note_id', '=', note.id)
      .orderBy('tags.name')
      .execute()
    expect(noteTags).toEqual([
      { name: 'search', origin: 'ai' },
      { name: 'user-tag', origin: 'user' },
    ])

    // AGE edges rewritten too
    const mentionCount = await queryCypher<{ c: unknown }>(
      trx,
      `MATCH (n:Note {id: '${note.id}'})-[r:MENTIONS]->() RETURN count(r)`,
      'c ag_catalog.agtype',
    )
    expect(Number(mentionCount[0]!.c)).toBe(1)
    const tagged = await cypherStrings(
      trx,
      `MATCH (n:Note {id: '${note.id}'})-[:TAGGED]->(t:Tag) RETURN t.name ORDER BY t.name`,
      'name',
    )
    expect(tagged).toEqual(['search', 'user-tag'])

    // workspace-level concepts from the first run are NOT wiped
    expect(await rowCount(trx, 'concepts', (q: any) => q.where('name_normalized', '=', 'kysely'))).toBe(1)
  })

  test('an LLM failure leaves no partial rows and marks the note failed', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-fail-llm')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    const embedding = stubEmbeddingProvider()
    const failingLLM: LLMProvider = {
      async complete() {
        throw new Error('openrouter is down')
      },
    }
    const registry = createStageRegistry({ llmProvider: failingLLM, embeddingProvider: embedding.provider })
    await expect(
      ingestNote({ db: trx, noteId: note.id, options: { registry, pipelines: PIPELINES } }),
    ).rejects.toThrow('openrouter is down')

    for (const table of ['chunks', 'concepts', 'relations', 'mentions', 'tags', 'links', 'sources'])
      expect(await rowCount(trx, table), table).toBe(0)

    const after = await trx
      .selectFrom('notes')
      .select('status')
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('failed')
  })

  test('a failure inside the store-graph transaction rolls back every relational write (atomicity)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-fail-store')
    await ensureNotesGraphCatalog(trx)
    // Create the target note so the link resolves; the failing mirror is
    // triggered by mergeLinkEdge, which runs late in the transaction after
    // concepts/relations/chunks/mentions/tags have been written.
    await givenNote(trx, workspaceId, '/proj/target.md', '# target')
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    const embedding = stubEmbeddingProvider()
    const llm = stubLLM(EXTRACTION)
    const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider: embedding.provider })
    const failingMirror: GraphMirror = {
      wipeNoteEdges,
      mergeNoteNode,
      mergeConceptNode,
      mergeRelatesToEdge,
      mergeMentionsEdge,
      mergeTagNode,
      mergeTaggedEdge,
      mergeLinkEdge: async () => {
        throw new Error('age exploded')
      },
    }
    registry.register(new StoreGraphStage(embedding.provider, failingMirror))

    await expect(
      ingestNote({ db: trx, noteId: note.id, options: { registry, pipelines: PIPELINES } }),
    ).rejects.toThrow('age exploded')

    for (const table of ['chunks', 'concepts', 'relations', 'mentions', 'tags', 'links', 'sources'])
      expect(await rowCount(trx, table), table).toBe(0)

    const after = await trx
      .selectFrom('notes')
      .select('status')
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('failed')
  })
})
