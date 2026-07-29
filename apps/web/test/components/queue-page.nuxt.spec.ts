import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import QueuePage from '../../app/pages/notes/queue.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

function statusResponse(overrides: Record<string, unknown> = {}) {
  return {
    db: { pending: 1, queued: 2, processing: 3, ingested: 4, failed: 5 },
    queue: { waiting: 6, active: 1, completed: 8, failed: 9, delayed: 0 },
    activeJobs: [{ id: 'n1', path: '/proj/active.md', title: 'Active Note' }],
    sweeper: { lastSweepAt: new Date().toISOString(), lastDispatched: 7, lastFailed: 1 },
    ...overrides,
  }
}

function mockQueueStatus(response: object, refresh = vi.fn()) {
  useFetchMock.mockImplementation((url: string) => {
    if (url === '/api/ingestion/status') {
      return {
        data: ref(response) as Ref<unknown>,
        pending: ref(false),
        refresh,
      }
    }
    return {
      data: ref(null) as Ref<unknown>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

describe('queue page', () => {
  it('renders DB status counts', async () => {
    mockQueueStatus(statusResponse())

    const component = await mountSuspended(QueuePage)
    const html = component.html()

    expect(html).toContain('Pending')
    expect(html).toContain('1')
    expect(html).toContain('Queued')
    expect(html).toContain('2')
    expect(html).toContain('Processing')
    expect(html).toContain('3')
    expect(html).toContain('Ingested')
    expect(html).toContain('4')
    expect(html).toContain('Failed')
    expect(html).toContain('5')
  })

  it('renders BullMQ queue counts', async () => {
    mockQueueStatus(statusResponse())

    const component = await mountSuspended(QueuePage)
    const html = component.html()

    expect(html).toContain('Waiting')
    expect(html).toContain('6')
    expect(html).toContain('Active')
    expect(html).toContain('1')
  })

  it('shows a queue-unavailable message when Redis is not configured', async () => {
    mockQueueStatus(statusResponse({ queue: null, activeJobs: [] }))

    const component = await mountSuspended(QueuePage)
    const html = component.html()

    expect(html).toContain('Queue unavailable')
  })

  it('renders active jobs with links to note detail', async () => {
    mockQueueStatus(statusResponse())

    const component = await mountSuspended(QueuePage)
    const links = component.findAll('a').map(a => a.attributes('href'))

    expect(links).toContain('/notes/proj/active.md')
  })

  it('renders the sweeper heartbeat', async () => {
    mockQueueStatus(statusResponse())

    const component = await mountSuspended(QueuePage)
    const html = component.html()

    expect(html).toContain('7')
    expect(html).toContain('1')
  })

  it('polls the ingestion status endpoint every 3 seconds', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    mockQueueStatus(statusResponse(), refresh)

    await mountSuspended(QueuePage)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
