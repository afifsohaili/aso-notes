import { describe, expect, it } from 'vitest'
import { parseLastRun } from '../../server/lib/pipeline/last-run'

function validLastRun(overrides?: Record<string, unknown>): Record<string, unknown> {
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

describe('parseLastRun', () => {
  it('accepts a valid full record', () => {
    const parsed = parseLastRun(validLastRun())
    expect(parsed).not.toBeNull()
    expect(parsed!.pipeline).toBe('markdown-note-with-links')
    expect(parsed!.status).toBe('succeeded')
    expect(parsed!.extraction!.counts).toEqual({ concepts: 3, relations: 2, mentions: 5, tags: 1 })
  })

  it('returns null for null input', () => {
    expect(parseLastRun(null)).toBeNull()
  })

  it('returns null for non-object garbage', () => {
    expect(parseLastRun('garbage')).toBeNull()
    expect(parseLastRun(42)).toBeNull()
    expect(parseLastRun([])).toBeNull()
  })

  it('returns null when required top-level fields are missing', () => {
    for (const key of Object.keys(validLastRun())) {
      const payload = validLastRun()
      delete payload[key]
      expect(parseLastRun(payload)).toBeNull()
    }
  })

  it('allows extraction to be null', () => {
    const parsed = parseLastRun(validLastRun({ extraction: null }))
    expect(parsed).not.toBeNull()
    expect(parsed!.extraction).toBeNull()
  })

  it('rejects status values outside the enum', () => {
    expect(parseLastRun(validLastRun({ status: 'pending' }))).toBeNull()
    expect(parseLastRun(validLastRun({ status: 'Succeeded' }))).toBeNull()
  })

  it('allows error to be null on success', () => {
    const parsed = parseLastRun(validLastRun({ error: null, status: 'succeeded' }))
    expect(parsed).not.toBeNull()
    expect(parsed!.error).toBeNull()
  })

  it('accepts a valid error object', () => {
    const parsed = parseLastRun(validLastRun({
      status: 'failed',
      failed_stage: 'extract-graph',
      error: { name: 'Error', message: 'boom', stack: 'at x' },
    }))
    expect(parsed).not.toBeNull()
    expect(parsed!.error).toEqual({ name: 'Error', message: 'boom', stack: 'at x' })
  })

  it('rejects error missing required fields', () => {
    expect(parseLastRun(validLastRun({ error: { name: 'Error' } }))).toBeNull()
    expect(parseLastRun(validLastRun({ error: { message: 'boom' } }))).toBeNull()
  })

  it('rejects extraction with missing required fields', () => {
    const extraction = validLastRun().extraction as Record<string, unknown>
    for (const key of Object.keys(extraction)) {
      const bad = { ...extraction }
      delete bad[key]
      expect(parseLastRun(validLastRun({ extraction: bad }))).toBeNull()
    }
  })

  it('rejects usage when it is not null or a valid object', () => {
    expect(parseLastRun(validLastRun({ extraction: { ...(validLastRun().extraction as object), usage: 'none' } }))).toBeNull()
  })
})
