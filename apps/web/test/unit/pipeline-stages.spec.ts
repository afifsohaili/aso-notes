import type { EmbeddingProvider } from '../../server/lib/ai/types'
import type { ExtractedSource, PipelineNote } from '../../server/lib/pipeline/types'
import { describe, expect, it } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { ChunkMarkdownAwareStage } from '../../server/lib/pipeline/stages/chunk-markdown-aware'
import { EmbedChunksStage } from '../../server/lib/pipeline/stages/embed-chunks'
import { ExtractSourcesStage } from '../../server/lib/pipeline/stages/extract-sources'

function fakeNote(overrides: Partial<PipelineNote> = {}): PipelineNote {
  return {
    id: 'note-1',
    workspace_id: 'ws-1',
    folder_id: null,
    path: '/a.md',
    title: 'a',
    content: '',
    pipeline: 'markdown-note',
    ...overrides,
  }
}

function fakeCtx(note: PipelineNote): PipelineContext {
  return new PipelineContext({ note, workspaceId: note.workspace_id, db: null as never })
}

function embeddingOf(dim: number): number[] {
  return Array.from({ length: dim }).fill(0.1)
}

describe('chunkMarkdownAwareStage', () => {
  it('chunks the note content onto ctx.chunks', async () => {
    const ctx = fakeCtx(fakeNote({ content: '# Head\n\nsome body text' }))
    await new ChunkMarkdownAwareStage().invoke(ctx)
    expect(ctx.chunks).toHaveLength(1)
    expect(ctx.chunks![0]!.text).toContain('some body text')
    expect(ctx.chunks![0]!.headingPath).toEqual(['Head'])
  })

  it('produces zero chunks for empty content', async () => {
    const ctx = fakeCtx(fakeNote({ content: '' }))
    await new ChunkMarkdownAwareStage().invoke(ctx)
    expect(ctx.chunks).toEqual([])
  })
})

describe('embedChunksStage', () => {
  it('embeds every chunk with cover chain and heading path prepended', async () => {
    const seen: string[][] = []
    const provider: EmbeddingProvider = {
      async embed(texts) {
        seen.push(texts)
        return texts.map(() => embeddingOf(2048))
      },
    }
    const ctx = fakeCtx(fakeNote())
    ctx.coverChain = 'folder cover context'
    ctx.chunks = [
      { index: 0, text: 'chunk zero', tokenCount: 3, headingPath: ['A', 'B'] },
      { index: 1, text: 'chunk one', tokenCount: 3, headingPath: [] },
    ]

    await new EmbedChunksStage(provider).invoke(ctx)

    expect(seen).toHaveLength(1) // single batch
    const inputs = seen[0]!
    expect(inputs[0]).toContain('folder cover context')
    expect(inputs[0]).toContain('A > B')
    expect(inputs[0]).toContain('chunk zero')
    expect(inputs[1]).toContain('chunk one')
    expect(ctx.chunks![0]!.embedding).toHaveLength(2048)
    expect(ctx.chunks![1]!.embedding).toHaveLength(2048)
  })

  it('batches embedding calls in groups of at most 100', async () => {
    const batchSizes: number[] = []
    const provider: EmbeddingProvider = {
      async embed(texts) {
        batchSizes.push(texts.length)
        return texts.map(() => embeddingOf(2048))
      },
    }
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = Array.from({ length: 250 }, (_, i) => ({
      index: i,
      text: `chunk ${i}`,
      tokenCount: 3,
      headingPath: [],
    }))

    await new EmbedChunksStage(provider).invoke(ctx)

    expect(batchSizes).toEqual([100, 100, 50])
    expect(ctx.chunks!.every(c => c.embedding?.length === 2048)).toBe(true)
  })

  it('throws when the provider returns a wrong-dimension embedding', async () => {
    const provider: EmbeddingProvider = {
      async embed(texts) {
        return texts.map(() => embeddingOf(1536))
      },
    }
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = [{ index: 0, text: 'chunk zero', tokenCount: 3, headingPath: [] }]

    await expect(new EmbedChunksStage(provider).invoke(ctx)).rejects.toThrow(/2048/)
  })

  it('throws when the provider returns fewer embeddings than inputs', async () => {
    const provider: EmbeddingProvider = {
      async embed() {
        return [embeddingOf(2048)]
      },
    }
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = [
      { index: 0, text: 'a', tokenCount: 1, headingPath: [] },
      { index: 1, text: 'b', tokenCount: 1, headingPath: [] },
    ]

    await expect(new EmbedChunksStage(provider).invoke(ctx)).rejects.toThrow()
  })

  it('is a no-op when there are no chunks', async () => {
    let called = false
    const provider: EmbeddingProvider = {
      async embed() {
        called = true
        return []
      },
    }
    const ctx = fakeCtx(fakeNote())
    ctx.chunks = []
    await new EmbedChunksStage(provider).invoke(ctx)
    expect(called).toBe(false)
  })
})

describe('extractSourcesStage', () => {
  it('extracts, normalizes and types external URLs from raw markdown', async () => {
    const content = [
      'Watch [this talk](https://www.youtube.com/watch?v=abc123&t=42s) and',
      'also https://youtu.be/def456?t=9 plus <https://example.com/page?utm_source=x>.',
    ].join('\n')
    const ctx = fakeCtx(fakeNote({ content }))

    await new ExtractSourcesStage().invoke(ctx)

    const sources = ctx.getOutput<ExtractedSource[]>('sources')!
    expect(sources).toEqual([
      { url: 'https://www.youtube.com/watch?v=abc123&t=42s', urlNormalized: 'youtube.com/watch?v=abc123', type: 'youtube' },
      { url: 'https://youtu.be/def456?t=9', urlNormalized: 'youtube.com/watch?v=def456', type: 'youtube' },
      { url: 'https://example.com/page?utm_source=x', urlNormalized: 'example.com/page', type: 'web' },
    ])
  })

  it('dedupes by normalized URL, keeping the first raw occurrence', async () => {
    const content = 'https://youtu.be/abc123 and later https://www.youtube.com/watch?v=abc123&t=5'
    const ctx = fakeCtx(fakeNote({ content }))

    await new ExtractSourcesStage().invoke(ctx)

    const sources = ctx.getOutput<ExtractedSource[]>('sources')!
    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('https://youtu.be/abc123')
  })

  it('outputs an empty list when the note has no URLs', async () => {
    const ctx = fakeCtx(fakeNote({ content: 'no links here' }))
    await new ExtractSourcesStage().invoke(ctx)
    expect(ctx.getOutput<ExtractedSource[]>('sources')).toEqual([])
  })
})
