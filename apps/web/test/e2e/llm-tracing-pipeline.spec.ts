import type { CompletionRequest, EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { TracedEmbeddingProvider, TracedLLMProvider } from '../../server/lib/observability/traced-provider'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { parseLastRun } from '../../server/lib/pipeline/last-run'
import { createStageRegistry } from '../../server/lib/pipeline/singleton'
import { ingestNote } from '../../server/lib/sync/ingest'
import { ensureNotesGraphCatalog } from './age-catalog'

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
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01) as number[])
    },
  }
  return { calls, provider }
}

function stubLLM(payload: object) {
  const requests: CompletionRequest[] = []
  const provider: LLMProvider = {
    async complete(request) {
      requests.push(request)
      return {
        message: { role: 'assistant', content: JSON.stringify(payload) },
        usage: { promptTokens: 42, completionTokens: 24, cost: 0.0003 },
      }
    },
  }
  return { provider, requests }
}

function createTracedRegistry(trx: any) {
  const embedding = stubEmbeddingProvider()
  const llm = stubLLM(EXTRACTION)

  const tracedLLM = new TracedLLMProvider(llm.provider, {
    db: trx,
    provider: 'openrouter',
    model: 'openrouter/test-extraction',
    llmUseCase: 'extraction',
  })

  const tracedEmbedding = new TracedEmbeddingProvider(embedding.provider, {
    db: trx,
    provider: 'openrouter',
    model: 'openrouter/test-embedding',
    llmUseCase: 'embedding',
  })

  const registry = createStageRegistry({ llmProvider: tracedLLM, embeddingProvider: tracedEmbedding })

  return { registry, embedding, llm }
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

describe('llm tracing: ingestion pipeline', () => {
  test('creates one trace per ingestion run with extraction + embedding generations', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'trace-ingestion')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)
    const { registry, llm } = createTracedRegistry(trx)

    await ingestNote({ db: trx, noteId: note.id, options: { registry, pipelines: PIPELINES } })

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'notes')
      .where('owner_id', '=', note.id)
      .executeTakeFirstOrThrow()

    expect(trace.workspace_id).toBe(workspaceId)
    expect(trace.kind).toBe('ingestion')
    expect(trace.status).toBe('completed')
    expect(trace.error).toBeNull()

    const generations = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .orderBy('seq', 'asc')
      .execute()

    expect(generations.length).toBeGreaterThanOrEqual(2)

    const extractionGen = generations.find(g => g.llm_use_case === 'extraction')
    expect(extractionGen).toBeDefined()
    expect(extractionGen!.workspace_id).toBe(workspaceId)
    expect(extractionGen!.seq).toBeGreaterThanOrEqual(0)
    expect(extractionGen!.prompt).toEqual(llm.requests[0]!.messages)
    expect(extractionGen!.response).toEqual({ role: 'assistant', content: JSON.stringify(EXTRACTION) })
    expect(extractionGen!.prompt_tokens).toBe(42)
    expect(extractionGen!.completion_tokens).toBe(24)
    expect(extractionGen!.cost_usd).toBe('0.000300')
    expect(extractionGen!.usage_missing).toBe(false)

    const embeddingGens = generations.filter(g => g.llm_use_case === 'embedding')
    expect(embeddingGens.length).toBeGreaterThan(0)
    for (const gen of embeddingGens) {
      expect(gen.workspace_id).toBe(workspaceId)
      expect(gen.prompt).toBeNull()
      expect(gen.response).toBeNull()
    }

    const after = await trx
      .selectFrom('notes')
      .select('last_run')
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow()

    const lastRun = parseLastRun(after.last_run)
    expect(lastRun).not.toBeNull()
    expect(lastRun!.extraction).not.toBeNull()
    expect(lastRun!.extraction!.trace_id).toBe(trace.id)
    expect('messages' in lastRun!.extraction!).toBe(false)
    expect('response' in lastRun!.extraction!).toBe(false)
    expect(lastRun!.extraction!.counts).toEqual({ concepts: 2, relations: 1, mentions: 2, tags: 1 })
  })

  test('marks the ingestion trace failed when extraction fails', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'trace-ingestion-fail')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)

    const tracedLLM = new TracedLLMProvider(
      {
        async complete() {
          throw new Error('extraction model is down')
        },
      },
      {
        db: trx,
        provider: 'openrouter',
        model: 'openrouter/test-extraction',
        llmUseCase: 'extraction',
      },
    )
    const embedding = stubEmbeddingProvider()
    const tracedEmbedding = new TracedEmbeddingProvider(embedding.provider, {
      db: trx,
      provider: 'openrouter',
      model: 'openrouter/test-embedding',
      llmUseCase: 'embedding',
    })
    const registry = createStageRegistry({ llmProvider: tracedLLM, embeddingProvider: tracedEmbedding })

    await expect(
      ingestNote({ db: trx, noteId: note.id, options: { registry, pipelines: PIPELINES } }),
    ).rejects.toThrow('extraction model is down')

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'notes')
      .where('owner_id', '=', note.id)
      .executeTakeFirstOrThrow()

    expect(trace.kind).toBe('ingestion')
    expect(trace.status).toBe('failed')
    expect(trace.error).toContain('extraction model is down')
  })

  test('keeps ingestion trace rows even when store-graph fails', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'trace-ingestion-store-fail')
    await ensureNotesGraphCatalog(trx)
    const note = await givenNote(trx, workspaceId, '/proj/main.md', NOTE_CONTENT)
    const { registry } = createTracedRegistry(trx)

    // Force a late pipeline failure by referencing a stage that is not registered.
    const brokenPipelines = {
      'markdown-note-with-links': [
        'resolve-covers',
        'chunk-markdown-aware',
        'embed-chunks',
        'extract-graph',
        'missing-stage',
      ],
    }

    await expect(
      ingestNote({ db: trx, noteId: note.id, options: { registry, pipelines: brokenPipelines as any } }),
    ).rejects.toThrow()

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'notes')
      .where('owner_id', '=', note.id)
      .executeTakeFirstOrThrow()

    expect(trace.kind).toBe('ingestion')
    expect(trace.status).toBe('failed')

    const generations = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .execute()

    expect(generations.length).toBeGreaterThanOrEqual(1)
  })
})
