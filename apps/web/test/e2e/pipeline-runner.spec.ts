import type { Stage } from '../../server/lib/pipeline/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { StageRegistry } from '../../server/lib/pipeline/registry'
import { runPipeline } from '../../server/lib/pipeline/run-pipeline'

/**
 * M2 feature spec for the pipeline executor: runPipeline drives registered
 * stages in order against a real note row, sharing one PipelineContext.
 */

async function givenNote(trx: any, workspaceId: string, path: string) {
  return trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, path, title: path, content: '# hello\n\nworld' })
    .returning(['id', 'workspace_id', 'folder_id', 'path', 'title', 'content', 'pipeline'])
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
})
