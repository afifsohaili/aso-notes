import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NoteList from '../../app/components/notes/note-list.vue'

function lastRun(overrides: Record<string, unknown> = {}) {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'failed',
    failed_stage: 'extract-graph',
    error: { name: 'Error', message: 'LLM extraction failed' },
    attempt: 1,
    job_id: null,
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.000Z',
    duration_ms: 5000,
    chunks: 4,
    extraction: {
      strategy: 'top-k',
      model: 'openai/gpt-4o-mini',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      counts: { concepts: 3, relations: 2, mentions: 5, tags: 1 },
    },
    ...overrides,
  }
}

describe('note-list retry', () => {
  const baseNote = {
    title: 'broken-note',
    path: '/proj/broken.md',
    tags: [],
    updatedAt: new Date().toISOString(),
    lastRun: null,
  }

  it('shows a retry button only for failed notes and emits retry with the path', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [
          { ...baseNote, status: 'failed', lastRun: lastRun() },
          { ...baseNote, path: '/proj/ok.md', status: 'ingested' },
          { ...baseNote, path: '/proj/wait.md', status: 'pending' },
        ],
        selectedPath: null,
      },
    })

    const retryButtons = component.findAll('button[title="Retry ingestion"]')
    expect(retryButtons).toHaveLength(1)

    await retryButtons[0]!.trigger('click')
    expect(component.emitted('retry')).toHaveLength(1)
    expect(component.emitted('retry')![0]).toEqual(['/proj/broken.md'])
  })

  it('does not emit select when retry is clicked', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [{ ...baseNote, status: 'failed', lastRun: lastRun() }],
        selectedPath: null,
      },
    })

    await component.find('button[title="Retry ingestion"]').trigger('click')
    expect(component.emitted('select')).toBeUndefined()
  })

  it('shows an error badge for failed notes with a last_run error', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [{ ...baseNote, status: 'failed', lastRun: lastRun() }],
        selectedPath: null,
      },
    })

    const html = component.html()
    expect(html).toContain('LLM extraction failed')
  })

  it('shows queued and processing status badges', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [
          { ...baseNote, status: 'queued', path: '/proj/queued.md' },
          { ...baseNote, status: 'processing', path: '/proj/processing.md' },
        ],
        selectedPath: null,
      },
    })

    const html = component.html()
    expect(html).toContain('Queued')
    expect(html).toContain('Processing')
  })
})
