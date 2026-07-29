import type { CompletionRequest, LLMProvider } from '../../server/lib/ai/types'
import type { PipelineNote } from '../../server/lib/pipeline/types'
import { describe, expect, it } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { ExtractGraphStage, vocabularyLoaderToStrategy } from '../../server/lib/pipeline/stages/extract-graph'

function fakeNote(overrides: Partial<PipelineNote> = {}): PipelineNote {
  return {
    id: 'note-1',
    workspace_id: 'ws-1',
    folder_id: null,
    path: '/a.md',
    title: 'a',
    content: '',
    content_hash: null,
    pipeline: 'markdown-note',
    ...overrides,
  }
}

function fakeCtx(note: PipelineNote): PipelineContext {
  return new PipelineContext({ note, workspaceId: note.workspace_id, db: null as never })
}

function stubLLM(payload: string | null, seen?: CompletionRequest[], extras?: { model?: string, usage?: { promptTokens: number, completionTokens: number } }): LLMProvider {
  return {
    async complete(request) {
      seen?.push(request)
      return { message: { role: 'assistant', content: payload }, ...extras }
    },
  }
}

const noVocab = () => vocabularyLoaderToStrategy(async () => ({ concepts: [], tags: [], topics: [] }))

describe('extractGraphStage', () => {
  it('requests structured output with the extraction json schema', async () => {
    const seen: CompletionRequest[] = []
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = [{ index: 0, text: 'body', tokenCount: 1, headingPath: [] }]

    await new ExtractGraphStage(stubLLM('{}', seen), noVocab).invoke(ctx)

    expect(seen).toHaveLength(1)
    const format = seen[0]!.responseFormat
    expect(format?.type).toBe('json_schema')
    if (format?.type === 'json_schema') {
      expect(format.jsonSchema.name).toBe('graph_extraction')
      expect(format.jsonSchema.schema).toHaveProperty('properties.topics')
      expect(format.jsonSchema.schema).toHaveProperty('properties.concepts')
      expect(format.jsonSchema.schema).toHaveProperty('properties.mentions')
      expect(format.jsonSchema.schema).toHaveProperty('properties.tags')
    }
  })

  it('assembles the prompt from ctx (cover chain, chunks) and the loaded vocabulary', async () => {
    const seen: CompletionRequest[] = []
    const ctx = fakeCtx(fakeNote({ title: 'Graph Notes', path: '/proj/graph.md' }))
    ctx.coverChain = 'cover context'
    ctx.chunks = [{ index: 0, text: 'about kysely', tokenCount: 3, headingPath: ['DB'] }]

    const strategy = vocabularyLoaderToStrategy(async () => ({
      concepts: [{ id: 'c1', name: 'Kysely', description: 'type-safe SQL' }],
      tags: ['databases'],
      topics: [],
    }))
    await new ExtractGraphStage(stubLLM('{}', seen), () => Promise.resolve(strategy)).invoke(ctx)

    const user = seen[0]!.messages[1]!.content as string
    expect(user).toContain('cover context')
    expect(user).toContain('Graph Notes')
    expect(user).toContain('about kysely')
    expect(user).toContain('Kysely')
    expect(user).toContain('databases')
    expect(ctx.vocabularyStrategy).toEqual({ id: 'test-loader', mergeOnStore: false })
  })

  it('records the full extraction payload on the context for last_run observability', async () => {
    const payload = JSON.stringify({
      concepts: [{ name: 'Alpha', description: 'first' }],
      relations: [{ from: 'Alpha', to: 'Beta', type: 'relates' }],
      mentions: [{ concept: 'Alpha', chunkRefs: [0] }],
      tags: ['t1', 't2'],
      topics: [{ name: 'T', description: 'topic' }],
    })
    const ctx = fakeCtx(fakeNote({ title: 'Capture Me', path: '/capture.md' }))
    ctx.coverChain = 'cover line'
    ctx.chunks = [{ index: 0, text: 'body', tokenCount: 1, headingPath: [] }]

    const strategy = vocabularyLoaderToStrategy(async () => ({
      concepts: [{ id: 'c1', name: 'Beta', description: 'second' }],
      tags: ['existing'],
      topics: [{ id: 't1', name: 'T', description: 'topic' }],
    }))

    await new ExtractGraphStage(
      stubLLM(payload, undefined, { model: 'test-model', usage: { promptTokens: 10, completionTokens: 5 } }),
      () => Promise.resolve(strategy),
    ).invoke(ctx)

    expect(ctx.extractionRecord).toMatchObject({
      strategy: 'test-loader',
      model: 'test-model',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      counts: { concepts: 1, relations: 1, mentions: 1, tags: 2 },
    })
    expect(ctx.extractionRecord!.messages).toHaveLength(2)
    expect(ctx.extractionRecord!.messages[0]!.role).toBe('system')
    expect(ctx.extractionRecord!.messages[1]!.role).toBe('user')
    expect(ctx.extractionRecord!.messages[1]!.content).toContain('Capture Me')
    expect(ctx.extractionRecord!.response).toBe(payload)
  })

  it('parses the model payload into ctx.extraction, dropping refs beyond ctx.chunks', async () => {
    const payload = JSON.stringify({
      concepts: [{ name: 'Alpha', description: 'first' }],
      mentions: [{ concept: 'Alpha', chunkRefs: [0, 7] }],
      tags: ['t'],
    })
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = [{ index: 0, text: 'body', tokenCount: 1, headingPath: [] }]

    await new ExtractGraphStage(stubLLM(payload), noVocab).invoke(ctx)

    expect(ctx.extraction?.concepts).toEqual([{ name: 'Alpha', description: 'first', topics: [] }])
    expect(ctx.extraction?.mentions).toEqual([{ concept: 'Alpha', chunkRefs: [0] }])
    expect(ctx.extraction?.tags).toEqual(['t'])
  })

  it('throws when the model returns no content', async () => {
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = []
    await expect(new ExtractGraphStage(stubLLM(null), noVocab).invoke(ctx)).rejects.toThrow()
  })
})
