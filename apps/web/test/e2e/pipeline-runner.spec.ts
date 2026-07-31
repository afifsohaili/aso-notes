import type { CompletionRequest, LLMProvider } from '../../server/lib/ai/types'
import type { Stage } from '../../server/lib/pipeline/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { StageRegistry } from '../../server/lib/pipeline/registry'
import { runPipeline } from '../../server/lib/pipeline/run-pipeline'
import { ChunkMarkdownAwareStage } from '../../server/lib/pipeline/stages/chunk-markdown-aware'
import { ExtractGraphStage, vocabularyLoaderToStrategy } from '../../server/lib/pipeline/stages/extract-graph'

/**
 * M2 feature spec for the pipeline executor: runPipeline drives registered
 * stages in order against a real note row, sharing one PipelineContext.
 */

async function givenNote(trx: any, workspaceId: string, path: string) {
  return trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, path, title: path, content: '# hello\n\nworld' })
    .returning(['id', 'workspace_id', 'synced_folder_id', 'folder_id', 'path', 'title', 'content', 'pipeline'])
    .executeTakeFirstOrThrow()
}

describe('runPipeline executor', () => {
  test('runs a registered pipeline over a real note row, threading the context', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'pipeline-exec' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const note = await givenNote(trx, workspace.id, '/exec.md')

    const seen: { stageId: string, noteId: string }[] = []
    const stub = (id: string, write?: (ctx: PipelineContext) => void): Stage => ({
      id,
      async invoke(ctx) {
        seen.push({ stageId: id, noteId: ctx.note.id })
        write?.(ctx)
      },
    })

    const registry = new StageRegistry()
    registry.register(stub('read-note', (ctx) => {
      ctx.setOutput('wordCount', ctx.note.content?.split(/\s+/).length)
    }))
    registry.register(stub('summarize'))

    const ctx = new PipelineContext({ note, workspaceId: workspace.id, db: trx })
    const result = await runPipeline('test-pipeline', ctx, {
      registry,
      pipelines: { 'test-pipeline': ['read-note', 'summarize'] },
    })

    expect(result).toBe(ctx)
    expect(seen.map(s => s.stageId)).toEqual(['read-note', 'summarize'])
    // every stage saw the same real note row
    expect(seen.every(s => s.noteId === note.id)).toBe(true)
    // outputs written by earlier stages are visible to later ones / the caller
    expect(ctx.getOutput('wordCount')).toBe(3)
  })

  test('a stage failure aborts the run and surfaces the failing stage id', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'pipeline-fail' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const note = await givenNote(trx, workspace.id, '/fail.md')

    const calls: string[] = []
    const registry = new StageRegistry()
    registry.register({
      id: 'ok',
      async invoke() {
        calls.push('ok')
      },
    })
    registry.register({
      id: 'bad',
      async invoke() {
        throw new Error('bad failed')
      },
    })
    registry.register({
      id: 'never',
      async invoke() {
        calls.push('never')
      },
    })

    const ctx = new PipelineContext({ note, workspaceId: workspace.id, db: trx })
    await expect(
      runPipeline('p', ctx, { registry, pipelines: { p: ['ok', 'bad', 'never'] } }),
    ).rejects.toThrow('bad failed')
    expect(calls).toEqual(['ok'])
  })

  test('accumulates last-run capture fields across real stages', async ({ trx }) => {
    const workspace = await trx
      .insertInto('workspaces')
      .values({ name: 'pipeline-capture' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const note = await givenNote(trx, workspace.id, '/capture.md')

    const seenStages: string[] = []
    const registry = new StageRegistry()
    registry.register(new ChunkMarkdownAwareStage())
    registry.register({
      id: 'spy',
      async invoke(ctx) {
        seenStages.push(ctx.currentStage!)
      },
    })

    const llmResponse = JSON.stringify({
      concepts: [{ name: 'Hello', description: 'greeting' }],
      relations: [],
      mentions: [{ concept: 'Hello', chunkRefs: [0] }],
      tags: ['demo'],
      topics: [{ name: 'Greetings', description: 'hellos' }],
    })
    const fakeLLM: LLMProvider = {
      async complete(_request: CompletionRequest) {
        return {
          message: { role: 'assistant', content: llmResponse },
          model: 'fake-extraction-model',
          usage: { promptTokens: 100, completionTokens: 50 },
        }
      },
    }
    registry.register(new ExtractGraphStage(fakeLLM, async () => vocabularyLoaderToStrategy(async () => ({
      concepts: [],
      tags: [],
      topics: [],
    }))))

    const ctx = new PipelineContext({ note, workspaceId: workspace.id, db: trx })
    await runPipeline('capture-pipeline', ctx, {
      registry,
      pipelines: { 'capture-pipeline': ['chunk-markdown-aware', 'spy', 'extract-graph'] },
    })

    expect(ctx.startedAt).toBeInstanceOf(Date)
    expect(seenStages).toEqual(['spy'])
    expect(ctx.currentStage).toBe('extract-graph')
    expect(ctx.chunksCount).toBe(ctx.chunks!.length)
    expect(ctx.extractionRecord).toMatchObject({
      strategy: 'test-loader',
      model: 'fake-extraction-model',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      response: llmResponse,
      counts: { concepts: 1, relations: 0, mentions: 1, tags: 1 },
    })
    expect(ctx.extractionRecord!.messages).toHaveLength(2)
    expect(ctx.extractionRecord!.messages[0]!.role).toBe('system')
    expect(ctx.extractionRecord!.messages[1]!.role).toBe('user')
    expect(ctx.extractionRecord!.response).toBe(llmResponse)
  })
})
