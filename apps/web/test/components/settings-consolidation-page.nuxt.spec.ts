import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsConsolidationPage from '../../app/pages/settings/extraction/consolidation.vue'

const { useFetchMock, $fetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
  $fetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

vi.stubGlobal('$fetch', $fetchMock)

interface Run {
  id: string
  mode: 'incremental' | 'full' | 'manual'
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  finishedAt: string | null
  counts: { merges: number, prunes: number, rewrites: number, dissolves: number, refiles: number, judgeCalls: number }
  usage: { promptTokens: number, completionTokens: number, totalTokens: number } | null
  metricsBefore: { concepts: number, topics: number, nearDupeRate: number, orphanRate: number, conceptsPerNote: number, topicSpread: number }
  metricsAfter: { concepts: number, topics: number, nearDupeRate: number, orphanRate: number, conceptsPerNote: number, topicSpread: number }
  flags: { overPruning: boolean, ineffectiveness: boolean }
  error: string | null
}

const completedRun: Run = {
  id: 'run-1',
  mode: 'manual',
  status: 'completed',
  startedAt: '2026-08-05T10:00:00.000Z',
  finishedAt: '2026-08-05T10:05:00.000Z',
  counts: { merges: 2, prunes: 1, rewrites: 0, dissolves: 0, refiles: 1, judgeCalls: 1 },
  usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
  metricsBefore: { concepts: 100, topics: 10, nearDupeRate: 0.05, orphanRate: 0.1, conceptsPerNote: 4, topicSpread: 2 },
  metricsAfter: { concepts: 95, topics: 9, nearDupeRate: 0.03, orphanRate: 0.08, conceptsPerNote: 3.8, topicSpread: 1.8 },
  flags: { overPruning: true, ineffectiveness: false },
  error: null,
}

const completedRunNoSnapshot: Run = {
  id: 'run-2',
  mode: 'incremental',
  status: 'completed',
  startedAt: '2026-08-04T10:00:00.000Z',
  finishedAt: '2026-08-04T10:02:00.000Z',
  counts: { merges: 0, prunes: 0, rewrites: 0, dissolves: 0, refiles: 0, judgeCalls: 0 },
  usage: null,
  metricsBefore: { concepts: 95, topics: 9, nearDupeRate: 0.03, orphanRate: 0.08, conceptsPerNote: 3.8, topicSpread: 1.8 },
  metricsAfter: { concepts: 95, topics: 9, nearDupeRate: 0.03, orphanRate: 0.08, conceptsPerNote: 3.8, topicSpread: 1.8 },
  flags: { overPruning: false, ineffectiveness: false },
  error: null,
}

const failedRun: Run = {
  id: 'run-3',
  mode: 'full',
  status: 'failed',
  startedAt: '2026-08-03T10:00:00.000Z',
  finishedAt: '2026-08-03T10:01:00.000Z',
  counts: { merges: 0, prunes: 0, rewrites: 0, dissolves: 0, refiles: 0, judgeCalls: 0 },
  usage: null,
  metricsBefore: { concepts: 100, topics: 10, nearDupeRate: 0.05, orphanRate: 0.1, conceptsPerNote: 4, topicSpread: 2 },
  metricsAfter: { concepts: 100, topics: 10, nearDupeRate: 0.05, orphanRate: 0.1, conceptsPerNote: 4, topicSpread: 2 },
  flags: { overPruning: false, ineffectiveness: false },
  error: 'Embedding provider returned empty vectors',
}

function detailFor(run: Run, changes: unknown[] = [], hasSnapshot = false) {
  return { run, changes, hasSnapshot }
}

function mockRunsResponse(runs: Run[]) {
  useFetchMock.mockImplementation((url: unknown) => {
    const resolved = typeof url === 'function' ? url() : url
    if (resolved === '/api/consolidation/runs') {
      return {
        data: ref({ runs }) as Ref<{ runs: Run[] }>,
        pending: ref(false),
        refresh: vi.fn(),
      }
    }
    return {
      data: ref(null) as Ref<unknown>,
      pending: ref(false),
      refresh: vi.fn(),
    }
  })
}

beforeEach(() => {
  $fetchMock.mockReset()
})

describe('settings consolidation page', () => {
  it('renders the run history list', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockResolvedValue(detailFor(completedRun, [], true))

    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.text()).toContain('Run consolidation now')
    expect(component.text()).toContain('Manual')
  })

  it('selects a run and renders its detail', async () => {
    const change = { id: 'c1', action: 'merge-concept', text: 'Merged A into B', reason: 'same concept', createdAt: '2026-08-05T10:04:00.000Z' }
    mockRunsResponse([completedRun])
    $fetchMock.mockResolvedValue(detailFor(completedRun, [change], true))

    const component = await mountSuspended(SettingsConsolidationPage)
    await flushPromises()

    expect(component.text()).toContain('Merged A into B')
    expect(component.text()).toContain('same concept')
  })

  it('renders before/after metrics and flags', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockResolvedValue(detailFor(completedRun, [], true))

    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.text()).toContain('100') // before concepts
    expect(component.text()).toContain('95') // after concepts
    expect(component.text()).toContain('5%') // nearDupeRate before 5%
    expect(component.text()).toContain('3%') // nearDupeRate after 3%
  })

  it('renders failed runs with an error', async () => {
    mockRunsResponse([failedRun])
    $fetchMock.mockResolvedValue(detailFor(failedRun, [], false))

    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.text()).toContain('Embedding provider returned empty vectors')
  })

  it('shows restore panel only when snapshot exists and restores after confirmation', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === `/api/consolidation/runs/${completedRun.id}/restore` && options?.method === 'POST')
        return { restored: true, counts: { concepts: 95, topics: 9, mentions: 10, relations: 4, conceptTopics: 8 } }
      return detailFor(completedRun, [], true)
    })

    const component = await mountSuspended(SettingsConsolidationPage)
    await flushPromises()

    expect(component.find('[data-testid="restore-panel"]').exists()).toBe(true)

    await component.find('[data-testid="restore-open-button"]').trigger('click')
    await component.find('[data-testid="restore-confirm-input"]').setValue('RESTORE')
    await component.find('[data-testid="restore-confirm-button"]').trigger('click')
    await flushPromises()

    expect($fetchMock).toHaveBeenCalledWith(`/api/consolidation/runs/${completedRun.id}/restore`, { method: 'POST' })
    expect(component.text()).toContain('Vocabulary restored')
  })

  it('does not show restore panel when no snapshot exists', async () => {
    mockRunsResponse([completedRunNoSnapshot])
    $fetchMock.mockResolvedValue(detailFor(completedRunNoSnapshot, [], false))

    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.find('[data-testid="restore-panel"]').exists()).toBe(false)
  })

  it('shows 409 conflict message', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/api/consolidation/run' && options?.method === 'POST')
        throw Object.assign(new Error('already running'), { statusCode: 409 })
      return detailFor(completedRun, [], true)
    })

    const component = await mountSuspended(SettingsConsolidationPage)
    await component.find('[data-testid="manual-run-button"]').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('already running')
  })

  it('shows 503 Redis unavailable message', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/api/consolidation/run' && options?.method === 'POST')
        throw Object.assign(new Error('queue unavailable'), { statusCode: 503 })
      return detailFor(completedRun, [], true)
    })

    const component = await mountSuspended(SettingsConsolidationPage)
    await component.find('[data-testid="manual-run-button"]').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('not available')
  })

  it('handles unexpected manual run errors', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/api/consolidation/run' && options?.method === 'POST')
        throw new Error('network')
      return detailFor(completedRun, [], true)
    })

    const component = await mountSuspended(SettingsConsolidationPage)
    await component.find('[data-testid="manual-run-button"]').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('Could not start')
  })

  it('toggles mobile view between list and detail', async () => {
    mockRunsResponse([completedRun])
    $fetchMock.mockResolvedValue(detailFor(completedRun, [], true))

    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.find('[data-testid="mobile-view"]').attributes('data-view')).toBe('list')

    await component.find('[data-testid="run-list-item"]').trigger('click')
    await flushPromises()

    expect(component.find('[data-testid="mobile-view"]').attributes('data-view')).toBe('detail')
  })
})
