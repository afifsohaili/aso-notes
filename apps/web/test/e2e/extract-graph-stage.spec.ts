import type { CompletionRequest, LLMProvider } from '../../server/lib/ai/types'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { EXTRACTION_SCHEMA, parseExtraction } from '../../server/lib/pipeline/extraction'
import { ExtractGraphStage } from '../../server/lib/pipeline/stages/extract-graph'
import { topKStrategy } from '../../server/lib/pipeline/vocabulary'
import { resolveVocabularyStrategy } from '../../server/lib/settings'

function stubLLM(payload: object | null, seen?: CompletionRequest[]): LLMProvider {
  return {
    async complete(request) {
      seen?.push(request)
      return { message: { role: 'assistant', content: payload ? JSON.stringify(payload) : null } }
    },
  }
}

function fakeNote(workspaceId: string) {
  return {
    id: 'note-1',
    workspace_id: workspaceId,
    folder_id: null,
    path: '/a.md',
    title: 'Graph Note',
    content: '# hello\n\nworld',
    content_hash: 'hash-1',
    pipeline: 'markdown-note',
  }
}

describe('extract-graph stage vocabulary strategies', () => {
  test('strategy=top-k prompt contains full topic list and at most K concepts', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'top-k-strategy' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('topics')
      .values([
        { workspace_id: workspace.id, name: 'Engineering', name_normalized: 'engineering' },
        { workspace_id: workspace.id, name: 'Billing', name_normalized: 'billing' },
      ])
      .execute()
    const chunkEmbedding = Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01))
    const nearEmbedding = chunkEmbedding.map(v => v)
    const farEmbedding = Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? -0.01 : 0.01))
    await trx
      .insertInto('concepts')
      .values([
        { workspace_id: workspace.id, name: 'Kysely', name_normalized: 'kysely', description: 'sql', embedding: `[${nearEmbedding.join(',')}]` },
        { workspace_id: workspace.id, name: 'Graph RAG', name_normalized: 'graph rag', description: 'rag', embedding: `[${farEmbedding.join(',')}]` },
      ])
      .execute()

    const seen: CompletionRequest[] = []
    const ctx = new PipelineContext({ note: fakeNote(workspace.id), workspaceId: workspace.id, db: trx })
    ctx.chunks = [{ index: 0, text: 'hello', tokenCount: 1, headingPath: [] }]
    ctx.embeddedChunks = [{ index: 0, text: 'hello', tokenCount: 1, headingPath: [], embedding: chunkEmbedding }]

    const k1Resolver = async () => topKStrategy({ k: 1 })
    await new ExtractGraphStage(stubLLM({ concepts: [], relations: [], mentions: [], tags: [], topics: [] }, seen), k1Resolver).invoke(ctx)

    expect(seen).toHaveLength(1)
    const user = seen[0]!.messages[1]!.content as string
    expect(user).toContain('## Existing topics (reuse these when they fit)')
    expect(user).toContain('Engineering')
    expect(user).toContain('Billing')
    // top-k with k=1 should inject the near concept (Kysely) but not the far one
    expect(user).toContain('Kysely')
    expect(user).not.toContain('Graph RAG')
  })

  test('strategy=blind-merge omits existing concepts and sets mergeOnStore on ctx', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'blind-merge-strategy' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspace.id}, 'extraction.vocabulary_strategy', ${JSON.stringify('blind-merge')}::jsonb)
    `.execute(trx)
    await trx
      .insertInto('concepts')
      .values({ workspace_id: workspace.id, name: 'Kysely', name_normalized: 'kysely', description: 'sql', embedding: null })
      .execute()

    const seen: CompletionRequest[] = []
    const ctx = new PipelineContext({ note: fakeNote(workspace.id), workspaceId: workspace.id, db: trx })
    ctx.chunks = [{ index: 0, text: 'hello', tokenCount: 1, headingPath: [] }]
    ctx.embeddedChunks = [{ index: 0, text: 'hello', tokenCount: 1, headingPath: [], embedding: Array.from({ length: 2048 }).fill(0.01) }]

    await new ExtractGraphStage(
      stubLLM({ concepts: [], relations: [], mentions: [], tags: [], topics: [] }, seen),
      resolveVocabularyStrategy,
    ).invoke(ctx)

    expect(ctx.vocabularyStrategy?.mergeOnStore).toBe(true)
    const user = seen[0]!.messages[1]!.content as string
    expect(user).not.toContain('Kysely')
    expect(user).toContain('(no existing concepts yet)')
  })

  test('extraction schema requires topics array', () => {
    expect(EXTRACTION_SCHEMA.required).toContain('topics')
    const topicsProp = (EXTRACTION_SCHEMA.properties as Record<string, unknown>).topics
    expect(topicsProp).toBeDefined()
  })

  test('parseExtraction tolerates topics and threads them into GraphExtraction', () => {
    const parsed = parseExtraction(JSON.stringify({
      concepts: [{ name: 'A', description: 'a', topics: ['Engineering'] }],
      relations: [],
      mentions: [{ concept: 'A', chunkRefs: [0] }],
      tags: [],
      topics: [{ name: 'Engineering', description: 'building things' }],
    }), 1)
    expect(parsed.topics).toEqual([{ name: 'Engineering', description: 'building things' }])
  })

  test('unknown strategy id in settings throws a clear error', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'bad-strategy' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspace.id}, 'extraction.vocabulary_strategy', ${JSON.stringify('unknown')}::jsonb)
    `.execute(trx)

    const ctx = new PipelineContext({ note: fakeNote(workspace.id), workspaceId: workspace.id, db: trx })
    await expect(
      new ExtractGraphStage(stubLLM({}), resolveVocabularyStrategy).invoke(ctx),
    ).rejects.toThrow('unknown vocabulary strategy')
  })
})
