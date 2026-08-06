import type { CompletionRequest, EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import type { GraphMirror } from '../../server/lib/pipeline/stages/store-graph'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import {
  conceptNeighbors,
  mergeConceptNode,
  mergeGroupedUnderEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  mergeTopicNode,
  parseAgtype,
  queryCypher,
  wipeNoteEdges,
} from '../../server/lib/graph'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { parseLastRun } from '../../server/lib/pipeline/last-run'
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

function unitVector(angleDegrees: number): number[] {
  const rad = angleDegrees * Math.PI / 180
  return Array.from({ length: 2048 }, (_, i) => {
    if (i === 0)
      return Math.cos(rad)
    if (i === 1)
      return Math.sin(rad)
    return 0
  })
}

function stubEmbeddingProviderForMerge(cases: { match: string, angle: number }[]) {
  const calls: string[][] = []
  const provider: EmbeddingProvider = {
    async embed(texts) {
      calls.push(texts)
      return texts.map((text) => {
        const match = cases.find(c => text.toLowerCase().includes(c.match.toLowerCase()))
        return unitVector(match ? match.angle : 90)
      })
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

async function ingest(trx: any, noteId: string, extraction: object, worker?: { attemptsMade?: number, jobId?: string }) {
  const embedding = stubEmbeddingProvider()
  const llm = stubLLM(extraction)
  const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider: embedding.provider })
  await ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES }, worker })
  return { embeddingCalls: embedding.calls, llmRequests: llm.requests }
}

async function ingestWithProvider(trx: any, noteId: string, extraction: object, embeddingProvider: EmbeddingProvider) {
  const llm = stubLLM(extraction)
  const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider })
  await ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES } })
  return { llmRequests: llm.requests }
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
      .select(['status', 'ingested_hash', 'ingested_at'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('ingested')
    expect(after.ingested_hash).toBe(note.content_hash)
    expect(after.ingested_at).not.toBeNull()
  })

  test('records a successful LastRun on the notes row after ingestion', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-lastrun-ok')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)
    const { llmRequests } = await ingest(trx, note.id, EXTRACTION)

    expect(llmRequests).toHaveLength(1)
    const after = await trx
      .selectFrom('notes')
      .select(['status', 'last_run'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()

    expect(after.status).toBe('ingested')
    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('succeeded')
    expect(lastRun!.pipeline).toBe('markdown-note-with-links')
    expect(lastRun!.failed_stage).toBeNull()
    expect(lastRun!.error).toBeNull()
    expect(lastRun!.attempt).toBe(0)
    expect(lastRun!.job_id).toBeNull()
    expect(lastRun!.chunks).toBe(2)
    expect(lastRun!.duration_ms).toBeGreaterThan(0)
    expect(lastRun!.extraction).toMatchObject({
      strategy: 'full',
      model: 'unknown',
      usage: null,
      response: JSON.stringify(EXTRACTION),
      counts: { concepts: 2, relations: 1, mentions: 2, tags: 1 },
    })
    expect(lastRun!.extraction!.messages).toHaveLength(2)
    expect(lastRun!.extraction!.messages[0]!.role).toBe('system')
    expect(lastRun!.extraction!.messages[1]!.role).toBe('user')
  })

  test('records worker attempt and job id when provided', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm4-lastrun-worker')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    await ingest(trx, note.id, EXTRACTION, { attemptsMade: 3, jobId: 'job-99' })

    const after = await trx
      .selectFrom('notes')
      .select('last_run')
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('succeeded')
    expect(lastRun!.attempt).toBe(3)
    expect(lastRun!.job_id).toBe('job-99')
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
      .select(['status', 'last_run'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('failed')

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('failed')
    expect(lastRun!.failed_stage).toBe('extract-graph')
    expect(lastRun!.error).toMatchObject({ name: 'Error', message: 'openrouter is down' })
    expect(lastRun!.error!.stack).toContain('openrouter is down')
    expect(lastRun!.attempt).toBe(0)
    expect(lastRun!.job_id).toBeNull()
    expect(lastRun!.duration_ms).toBeGreaterThanOrEqual(0)
    expect(lastRun!.extraction).toBeNull()
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
      mergeTopicNode,
      mergeRelatesToEdge,
      mergeGroupedUnderEdge,
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
      .select(['status', 'last_run'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()
    expect(after.status).toBe('failed')

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.status).toBe('failed')
    expect(lastRun!.failed_stage).toBe('store-graph')
    expect(lastRun!.error).toMatchObject({ name: 'Error', message: 'age exploded' })
    expect(lastRun!.extraction).not.toBeNull()
    expect(lastRun!.extraction!.counts).toEqual({ concepts: 2, relations: 1, mentions: 2, tags: 1 })
  })
})

describe('m3 store-graph topics and blind-merge', () => {
  test('persists topics, concept_topics and mirrors them to AGE', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm3-topics')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/topics.md', NOTE_CONTENT)
    await ingest(trx, note.id, EXTRACTION)

    const topics = await trx
      .selectFrom('topics')
      .select(['name', 'name_normalized', 'description', 'embedding'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('name')
      .execute()
    expect(topics).toHaveLength(1)
    expect(topics[0]!.name).toBe('Engineering')
    expect(topics[0]!.description).toBe('software engineering topics')
    expect(topics[0]!.embedding).not.toBeNull()

    const conceptTopics = await trx
      .selectFrom('concept_topics')
      .innerJoin('concepts', 'concepts.id', 'concept_topics.concept_id')
      .innerJoin('topics', 'topics.id', 'concept_topics.topic_id')
      .select(['concepts.name as concept_name', 'topics.name as topic_name'])
      .where('concept_topics.workspace_id', '=', workspaceId)
      .orderBy(['concepts.name', 'topics.name'])
      .execute()
    expect(conceptTopics).toEqual([
      { concept_name: 'Graph RAG', topic_name: 'Engineering' },
      { concept_name: 'Kysely', topic_name: 'Engineering' },
    ])

    const topicNames = await cypherStrings(
      trx,
      `MATCH (t:Topic {workspace_id: '${workspaceId}'}) RETURN t.name ORDER BY t.name`,
      'name',
    )
    expect(topicNames).toEqual(['Engineering'])

    const groupedUnder = await cypherStrings(
      trx,
      `MATCH (c:Concept {workspace_id: '${workspaceId}'})-[:GROUPED_UNDER]->(t:Topic {name: 'Engineering'}) RETURN c.name ORDER BY c.name`,
      'name',
    )
    expect(groupedUnder).toEqual(['Graph RAG', 'Kysely'])
  })

  test('reuses existing topics across notes and never overwrites descriptions', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm3-topic-reuse')
    await ensureNotesGraphCatalog(trx)
    const first = await givenNote(trx, workspaceId, '/proj/first.md', NOTE_CONTENT)
    const second = await givenNote(trx, workspaceId, '/proj/second.md', `# Second\n\n${'gamma '.repeat(180)}`)

    await ingest(trx, first.id, EXTRACTION)
    await ingest(trx, second.id, {
      concepts: [
        { name: 'Postgres', description: 'the database', topics: ['Engineering'] },
      ],
      relations: [],
      mentions: [{ concept: 'Postgres', chunkRefs: [0] }],
      tags: [],
      topics: [{ name: 'Engineering', description: 'changed description' }],
    })

    const topics = await trx
      .selectFrom('topics')
      .select(['name', 'description'])
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'engineering')
      .execute()
    expect(topics).toHaveLength(1)
    expect(topics[0]!.description).toBe('software engineering topics')

    const topicRows = await trx
      .selectFrom('topics')
      .select(sql<number>`count(*)::int`.as('c'))
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirstOrThrow()
    expect(topicRows.c).toBe(1)
  })

  test('blind-merge merges a new concept into an existing concept when similarity >= threshold', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm3-blind-merge')
    await ensureNotesGraphCatalog(trx)

    await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspaceId,
        name: 'Paddle',
        name_normalized: 'paddle',
        description: 'billing provider',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .execute()

    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspaceId}, 'extraction.vocabulary_strategy', ${JSON.stringify('blind-merge')}::jsonb)
    `.execute(trx)

    const note = await givenNote(trx, workspaceId, '/proj/paddle.md', `# Paddle\n\n${'alpha '.repeat(180)}`)

    await ingestWithProvider(trx, note.id, {
      concepts: [
        { name: 'Paddle Payments', description: 'paddle payments product', topics: ['Engineering'] },
        { name: 'Paddle Console', description: 'management ui', topics: ['Engineering'] },
      ],
      relations: [{ from: 'Paddle Payments', to: 'Paddle Console', type: 'has-product' }],
      mentions: [
        { concept: 'Paddle Payments', chunkRefs: [0] },
        { concept: 'Paddle Console', chunkRefs: [0] },
      ],
      tags: [],
      topics: [{ name: 'Engineering', description: 'software engineering' }],
    }, stubEmbeddingProviderForMerge([
      { match: 'paddle payments', angle: 0 },
      { match: 'paddle console', angle: 60 },
    ]).provider)

    const concepts = await trx
      .selectFrom('concepts')
      .select(['name', 'name_normalized'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('name')
      .execute()
    expect(concepts).toEqual([
      { name: 'Paddle', name_normalized: 'paddle' },
      { name: 'Paddle Console', name_normalized: 'paddle console' },
    ])

    const relations = await trx
      .selectFrom('relations')
      .innerJoin('concepts as from_c', 'from_c.id', 'relations.from_concept_id')
      .innerJoin('concepts as to_c', 'to_c.id', 'relations.to_concept_id')
      .select(['from_c.name as from_name', 'to_c.name as to_name'])
      .where('relations.workspace_id', '=', workspaceId)
      .execute()
    expect(relations).toEqual([{ from_name: 'Paddle', to_name: 'Paddle Console' }])

    const mentions = await trx
      .selectFrom('mentions')
      .innerJoin('concepts', 'concepts.id', 'mentions.concept_id')
      .select('concepts.name')
      .where('mentions.workspace_id', '=', workspaceId)
      .execute()
    expect(mentions.map(m => m.name).sort()).toEqual(['Paddle', 'Paddle Console'])
  })

  test('blind-merge below threshold creates a new concept row', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm3-blind-merge-miss')
    await ensureNotesGraphCatalog(trx)

    await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspaceId,
        name: 'Paddle',
        name_normalized: 'paddle',
        description: 'billing provider',
        embedding: halfvecLiteral(unitVector(0)),
      })
      .execute()

    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspaceId}, 'extraction.vocabulary_strategy', ${JSON.stringify('blind-merge')}::jsonb)
    `.execute(trx)

    const note = await givenNote(trx, workspaceId, '/proj/stripe.md', `# Stripe\n\n${'alpha '.repeat(180)}`)
    await ingestWithProvider(trx, note.id, {
      concepts: [
        { name: 'Stripe Checkout', description: 'stripe checkout product', topics: ['Engineering'] },
      ],
      relations: [{ from: 'Stripe Checkout', to: 'Paddle', type: 'competes-with' }],
      mentions: [{ concept: 'Stripe Checkout', chunkRefs: [0] }],
      tags: [],
      topics: [{ name: 'Engineering', description: 'software engineering' }],
    }, stubEmbeddingProviderForMerge([{ match: 'stripe checkout', angle: 45 }]).provider)

    const stripe = await trx
      .selectFrom('concepts')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('name_normalized', '=', 'stripe checkout')
      .execute()
    expect(stripe).toHaveLength(1)
    expect(stripe[0]!.name).toBe('Stripe Checkout')

    const relations = await trx
      .selectFrom('relations')
      .innerJoin('concepts as from_c', 'from_c.id', 'relations.from_concept_id')
      .innerJoin('concepts as to_c', 'to_c.id', 'relations.to_concept_id')
      .select(['from_c.name as from_name', 'to_c.name as to_name'])
      .where('relations.workspace_id', '=', workspaceId)
      .execute()
    expect(relations).toEqual([{ from_name: 'Stripe Checkout', to_name: 'Paddle' }])
  })
})
