import { describe, expect, it } from 'vitest'
import { PipelineContext } from '../../server/lib/pipeline/context'
import { buildLastRun, parseLastRun } from '../../server/lib/pipeline/last-run'

const note: PipelineContext['note'] = {
  id: 'n1',
  workspace_id: 'ws1',
  folder_id: null,
  path: '/a.md',
  title: 'A',
  content: 'hello',
  content_hash: 'hash-a',
  pipeline: 'markdown-note',
}

const extraction = {
  strategy: 'top-k',
  model: 'fake-model',
  messages: [{ role: 'system', content: 'extract' }, { role: 'user', content: 'note' }],
  response: '{"concepts":[]}',
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  counts: { concepts: 1, relations: 0, mentions: 0, tags: 0 },
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const ctx = new PipelineContext({ note, workspaceId: 'ws1', db: {} as any })
  ctx.startedAt = new Date('2026-07-29T10:00:00.000Z')
  ctx.currentStage = 'extract-graph'
  ctx.chunksCount = 3
  ctx.extractionRecord = extraction
  Object.assign(ctx, overrides)
  return ctx
}

describe('buildLastRun', () => {
  it('assembles a valid success LastRun', () => {
    const ctx = makeContext()
    const run = buildLastRun(ctx, { status: 'succeeded', worker: null })

    expect(parseLastRun(run)).not.toBeNull()
    expect(run.status).toBe('succeeded')
    expect(run.failed_stage).toBeNull()
    expect(run.error).toBeNull()
    expect(run.pipeline).toBe('markdown-note')
    expect(run.chunks).toBe(3)
    expect(run.extraction).toBe(extraction)
    expect(run.attempt).toBe(0)
    expect(run.job_id).toBeNull()
    expect(run.duration_ms).toBeGreaterThanOrEqual(0)
    expect(new Date(run.started_at).toISOString()).toBe(ctx.startedAt.toISOString())
    expect(new Date(run.finished_at).getTime()).toBeGreaterThanOrEqual(ctx.startedAt.getTime())
  })

  it('assembles a failed LastRun with the failing stage and serialized error', () => {
    const ctx = makeContext()
    const error = new Error('stage blew up')
    const run = buildLastRun(ctx, { status: 'failed', error, worker: null })

    expect(parseLastRun(run)).not.toBeNull()
    expect(run.status).toBe('failed')
    expect(run.failed_stage).toBe('extract-graph')
    expect(run.error).toMatchObject({ name: 'Error', message: 'stage blew up' })
    expect(run.error?.stack).toContain('stage blew up')
  })

  it('serializes a non-Error throw as name Error and String(value)', () => {
    const ctx = makeContext()
    expect(buildLastRun(ctx, { status: 'failed', error: 'string failure', worker: null }).error)
      .toEqual({ name: 'Error', message: 'string failure' })
    expect(buildLastRun(ctx, { status: 'failed', error: { reason: 'object failure' }, worker: null }).error)
      .toEqual({ name: 'Error', message: '[object Object]' })
  })

  it('leaves extraction null when no extraction stage ran', () => {
    const ctx = makeContext({ extractionRecord: null })
    const run = buildLastRun(ctx, { status: 'failed', error: new Error('early'), worker: null })

    expect(run.extraction).toBeNull()
    expect(parseLastRun(run)).not.toBeNull()
  })

  it('records worker attempt and job id when provided', () => {
    const ctx = makeContext()
    const run = buildLastRun(ctx, {
      status: 'succeeded',
      worker: { attemptsMade: 2, jobId: 'job-42' },
    })

    expect(run.attempt).toBe(2)
    expect(run.job_id).toBe('job-42')
  })

  it('never reports a negative duration', () => {
    const future = new Date('2026-07-29T12:00:00.000Z')
    const ctx = makeContext({ startedAt: future })
    const run = buildLastRun(ctx, { status: 'succeeded', worker: null })

    expect(run.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
