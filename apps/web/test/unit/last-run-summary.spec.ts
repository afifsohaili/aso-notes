import type { LastRun } from '../../server/lib/pipeline/last-run'
import { describe, expect, it } from 'vitest'
import { toLastRunSummary } from '../../server/lib/pipeline/last-run'

function makeLastRun(overrides?: Partial<LastRun>): LastRun {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'succeeded',
    failed_stage: null,
    error: null,
    attempt: 1,
    job_id: 'job-123',
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.123Z',
    duration_ms: 5123,
    chunks: 4,
    extraction: {
      strategy: 'top-k',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: 'extract' }, { role: 'user', content: 'note' }],
      response: '{"concepts":[]}',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      counts: { concepts: 3, relations: 2, mentions: 5, tags: 1 },
    },
    ...overrides,
  }
}

describe('toLastRunSummary', () => {
  it('keeps top-level fields and extraction meta but strips messages and response', () => {
    const summary = toLastRunSummary(makeLastRun())
    expect(summary.pipeline).toBe('markdown-note-with-links')
    expect(summary.status).toBe('succeeded')
    expect(summary.duration_ms).toBe(5123)
    expect(summary.extraction).not.toBeNull()
    expect(summary.extraction!.strategy).toBe('top-k')
    expect(summary.extraction!.counts).toEqual({ concepts: 3, relations: 2, mentions: 5, tags: 1 })
    expect(summary.extraction!.messages).toBeUndefined()
    expect(summary.extraction!.response).toBeUndefined()
  })

  it('preserves extraction when it is null', () => {
    const summary = toLastRunSummary(makeLastRun({ extraction: null }))
    expect(summary.extraction).toBeNull()
  })

  it('preserves failed-stage and error fields', () => {
    const summary = toLastRunSummary(makeLastRun({
      status: 'failed',
      failed_stage: 'extract-graph',
      error: { name: 'Error', message: 'boom' },
    }))
    expect(summary.status).toBe('failed')
    expect(summary.failed_stage).toBe('extract-graph')
    expect(summary.error).toEqual({ name: 'Error', message: 'boom' })
  })

  it('does not mutate the input record', () => {
    const record = makeLastRun()
    toLastRunSummary(record)
    expect(record.extraction!.messages).toHaveLength(2)
    expect(record.extraction!.response).toBe('{\"concepts\":[]}')
  })
})
