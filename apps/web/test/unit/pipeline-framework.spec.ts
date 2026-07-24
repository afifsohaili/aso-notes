import type { Stage } from '../../server/lib/pipeline/types'
import { describe, expect, it } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import {
  CHUNK_MARKDOWN_AWARE_STAGE,
  EMBED_CHUNKS_STAGE,
  EXTRACT_GRAPH_STAGE,
  EXTRACT_LINKS_STAGE,
  EXTRACT_SOURCES_STAGE,
  MARKDOWN_NOTE_PIPELINE,
  MARKDOWN_NOTE_WITH_LINKS_PIPELINE,
  PIPELINES,
  RESOLVE_COVERS_STAGE,
  STORE_GRAPH_STAGE,
} from '../../server/lib/pipeline/ids'
import { StageRegistry, validatePipelines } from '../../server/lib/pipeline/registry'
import { runPipeline } from '../../server/lib/pipeline/run-pipeline'

function stubStage(id: string, calls?: string[]): Stage {
  return {
    id,
    async invoke() {
      calls?.push(id)
    },
  }
}

function fakeCtx() {
  return new PipelineContext({
    note: {
      id: 'note-1',
      workspace_id: 'ws-1',
      folder_id: null,
      path: '/a.md',
      title: 'a',
      content: 'hello',
      pipeline: 'markdown-note',
    },
    workspaceId: 'ws-1',
    db: null as never,
  })
}

describe('pipelineContext', () => {
  it('stores and retrieves named outputs via setOutput/getOutput', () => {
    const ctx = fakeCtx()
    expect(ctx.getOutput('sources')).toBeUndefined()
    ctx.setOutput('sources', [{ url: 'https://x.com' }])
    expect(ctx.getOutput('sources')).toEqual([{ url: 'https://x.com' }])
    expect(ctx.extra.sources).toEqual([{ url: 'https://x.com' }])
  })
})

describe('stageRegistry', () => {
  it('returns a registered stage by id', () => {
    const registry = new StageRegistry()
    const stage = stubStage('a')
    registry.register(stage)
    expect(registry.get('a')).toBe(stage)
  })

  it('throws when getting an unregistered stage id', () => {
    const registry = new StageRegistry()
    expect(() => registry.get('nope')).toThrow(/unregistered stage/i)
  })

  it('throws when registering a stage whose id does not match', () => {
    const registry = new StageRegistry()
    expect(() => registry.register('other-id', stubStage('a'))).toThrow(/mismatch/i)
  })
})

describe('validatePipelines (boot-time validation)', () => {
  it('passes when every stage id in every pipeline is registered', () => {
    const registry = new StageRegistry()
    registry.register(stubStage('a'))
    registry.register(stubStage('b'))
    expect(() => validatePipelines(registry, { p1: ['a', 'b'] })).not.toThrow()
  })

  it('fails on a bad stage id, naming the pipeline and the id', () => {
    const registry = new StageRegistry()
    registry.register(stubStage('a'))
    expect(() => validatePipelines(registry, { p1: ['a', 'ghost'] })).toThrow(/p1.*ghost|ghost.*p1/i)
  })
})

describe('pIPELINES definitions', () => {
  it('markdown-note is the default five-stage pipeline', () => {
    expect(PIPELINES[MARKDOWN_NOTE_PIPELINE]).toEqual([
      RESOLVE_COVERS_STAGE,
      CHUNK_MARKDOWN_AWARE_STAGE,
      EMBED_CHUNKS_STAGE,
      EXTRACT_GRAPH_STAGE,
      STORE_GRAPH_STAGE,
    ])
  })

  it('markdown-note-with-links adds extract-links and extract-sources before store-graph', () => {
    expect(PIPELINES[MARKDOWN_NOTE_WITH_LINKS_PIPELINE]).toEqual([
      RESOLVE_COVERS_STAGE,
      CHUNK_MARKDOWN_AWARE_STAGE,
      EMBED_CHUNKS_STAGE,
      EXTRACT_GRAPH_STAGE,
      EXTRACT_LINKS_STAGE,
      EXTRACT_SOURCES_STAGE,
      STORE_GRAPH_STAGE,
    ])
  })
})

describe('runPipeline', () => {
  it('invokes the pipeline stages in order with the shared context', async () => {
    const calls: string[] = []
    const registry = new StageRegistry()
    registry.register(stubStage('a', calls))
    registry.register(stubStage('b', calls))
    const pipelines = { p: ['a', 'b'] }

    const ctx = fakeCtx()
    await runPipeline('p', ctx, { registry, pipelines })

    expect(calls).toEqual(['a', 'b'])
  })

  it('throws for an unknown pipeline id', async () => {
    const registry = new StageRegistry()
    await expect(runPipeline('ghost', fakeCtx(), { registry, pipelines: {} })).rejects.toThrow(/unknown pipeline/i)
  })

  it('propagates a stage failure and stops the pipeline', async () => {
    const calls: string[] = []
    const registry = new StageRegistry()
    registry.register(stubStage('a', calls))
    registry.register({
      id: 'boom',
      async invoke() {
        throw new Error('stage exploded')
      },
    })
    registry.register(stubStage('c', calls))

    await expect(
      runPipeline('p', fakeCtx(), { registry, pipelines: { p: ['a', 'boom', 'c'] } }),
    ).rejects.toThrow('stage exploded')
    expect(calls).toEqual(['a'])
  })
})
