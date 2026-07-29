import type { PipelineNote } from '../../server/lib/pipeline/types'
import { describe, expect, it } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { ChunkMarkdownAwareStage } from '../../server/lib/pipeline/stages/chunk-markdown-aware'

function fakeCtx(note: PipelineNote): PipelineContext {
  return new PipelineContext({ note, workspaceId: note.workspace_id, db: null as never })
}

function fakeNote(overrides: Partial<PipelineNote> = {}): PipelineNote {
  return {
    id: 'note-1',
    workspace_id: 'ws-1',
    folder_id: null,
    path: '/a.md',
    title: 'a',
    content: '# One\n\n## Two\n\nparagraph',
    content_hash: null,
    pipeline: 'markdown-note',
    ...overrides,
  }
}

describe('chunk-markdown-aware stage', () => {
  it('records the chunk count on the context', async () => {
    const ctx = fakeCtx(fakeNote())
    await new ChunkMarkdownAwareStage().invoke(ctx)

    expect(ctx.chunks).toBeDefined()
    expect(ctx.chunksCount).toBe(ctx.chunks!.length)
    expect(ctx.chunksCount).toBeGreaterThan(0)
  })

  it('records zero chunks for empty content', async () => {
    const ctx = fakeCtx(fakeNote({ content: '' }))
    await new ChunkMarkdownAwareStage().invoke(ctx)

    expect(ctx.chunks).toEqual([])
    expect(ctx.chunksCount).toBe(0)
  })
})
