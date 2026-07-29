import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NoteDetail from '../../app/components/notes/note-detail.vue'

function makeLastRun(overrides: Record<string, unknown> = {}) {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'failed',
    failed_stage: 'extract-graph',
    error: { name: 'Error', message: 'LLM extraction failed' },
    attempt: 2,
    job_id: 'job-123',
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.123Z',
    duration_ms: 5123,
    chunks: 4,
    extraction: {
      strategy: 'top-k',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: 'extract' }, { role: 'user', content: 'note body' }],
      response: '{"concepts":[]}',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      counts: { concepts: 3, relations: 2, mentions: 5, tags: 1 },
    },
    ...overrides,
  }
}

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    path: '/project-a/plan.md',
    title: 'Plan',
    content: '# Plan\n\nStart here.',
    renderMarkdown: true,
    status: 'failed',
    folder: '/project-a',
    tags: [],
    sources: [],
    updatedAt: new Date().toISOString(),
    lastRun: null,
    ...overrides,
  }
}

describe('note-detail', () => {
  it('renders note markdown and tag chips', async () => {
    const component = await mountSuspended(NoteDetail, {
      props: {
        note: makeNote({ status: 'ingested' }),
      },
    })

    const html = component.html()
    expect(html).toContain('Plan')
    expect(html).toContain('Start here')
  })

  it('renders an error badge when last_run status is failed', async () => {
    const component = await mountSuspended(NoteDetail, {
      props: {
        note: makeNote({ lastRun: makeLastRun() }),
      },
    })

    const html = component.html()
    expect(html).toContain('Last Run')
    expect(html).toContain('failed')
  })

  it('shows extraction meta in the last run panel', async () => {
    const component = await mountSuspended(NoteDetail, {
      props: {
        note: makeNote({ lastRun: makeLastRun() }),
      },
    })

    const html = component.html()
    expect(html).toContain('top-k')
    expect(html).toContain('openai/gpt-4o-mini')
    expect(html).toContain('3 concepts')
    expect(html).toContain('2 relations')
  })

  it('hides messages and response until expanded', async () => {
    const component = await mountSuspended(NoteDetail, {
      props: {
        note: makeNote({ lastRun: makeLastRun() }),
      },
    })

    expect(component.html()).not.toContain('note body')

    const buttons = component.findAll('button')
    const messagesButton = buttons.find(b => b.text().includes('Show messages'))
    expect(messagesButton).toBeDefined()
    await messagesButton!.trigger('click')
    expect(component.html()).toContain('note body')

    const responseButton = component.findAll('button').find(b => b.text().includes('Show raw response'))
    expect(responseButton).toBeDefined()
    await responseButton!.trigger('click')
    expect(component.html()).toContain('"concepts": []')
  })
})
