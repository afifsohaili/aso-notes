import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UsageSummary from '../../app/components/settings/usage/usage-summary.vue'

const baseSummary = {
  ranges: {
    today: { costUsd: '0.000300', tokens: 30, generations: 1, usageMissingGenerations: 0 },
    last7d: { costUsd: '0.000700', tokens: 70, generations: 3, usageMissingGenerations: 1 },
    last30d: { costUsd: '0.001200', tokens: 120, generations: 4, usageMissingGenerations: 1 },
  },
  daily: [
    {
      day: '2026-08-22',
      generations: 1,
      tokens: 30,
      costUsd: '0.000300',
      usageMissingGenerations: 0,
    },
    {
      day: '2026-08-21',
      generations: 1,
      tokens: 40,
      costUsd: '0.000400',
      usageMissingGenerations: 0,
    },
  ],
  groups: [
    {
      useCase: 'agent',
      model: 'anthropic/claude-sonnet-4.5',
      generations: 2,
      tokens: 30,
      costUsd: '0.000300',
      usageMissingGenerations: 1,
    },
    {
      useCase: 'extraction',
      model: 'openai/gpt-4.1-mini',
      generations: 1,
      tokens: 40,
      costUsd: '0.000400',
      usageMissingGenerations: 0,
    },
    {
      useCase: 'embedding',
      model: 'openai/text-embedding-3-large',
      generations: 1,
      tokens: 50,
      costUsd: '0.000500',
      usageMissingGenerations: 0,
    },
  ],
  total: {
    generations: 4,
    tokens: 120,
    costUsd: '0.001200',
    usageMissingGenerations: 1,
  },
}

describe('usage-summary', () => {
  it('renders the title, cards, and table with formatted metrics', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: { summary: baseSummary },
    })

    expect(component.text()).toContain('Usage & cost')
    expect(component.text()).toContain('Workspace-level LLM usage')
    expect(component.text()).toContain('Last 7 days')
    expect(component.text()).toContain('Last 30 days')
    expect(component.text()).toContain('$0.0003')
    expect(component.text()).toContain('$0.0007')
    expect(component.text()).toContain('$0.0012')
    expect(component.text()).toContain('30')
    expect(component.text()).toContain('120')

    expect(component.find('table').exists()).toBe(true)
    expect(component.text()).toContain('agent')
    expect(component.text()).toContain('extraction')
    expect(component.text()).toContain('embedding')
    expect(component.text()).toContain('Total')
  })

  it('renders each card metric as a horizontal label/value row', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: { summary: baseSummary },
    })

    const card = component.find('[data-testid="usage-card-today"]')
    const text = card.text()
    expect(text).toContain('Today')
    expect(text).toContain('Cost')
    expect(text).toContain('$0.0003')
    expect(text).toContain('Tokens')
    expect(text).toContain('30')
    expect(text).toContain('Generations')
    expect(text).toContain('1')
  })

  it('renders the daily breakdown table', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: { summary: baseSummary },
    })

    const dailyTable = component.find('[data-testid="usage-daily-table"]')
    expect(dailyTable.exists()).toBe(true)
    expect(dailyTable.text()).toContain('2026-08-22')
    expect(dailyTable.text()).toContain('2026-08-21')
  })

  it('shows an empty daily state when no daily rows exist but groups do', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: {
        summary: {
          ...baseSummary,
          daily: [],
        },
      },
    })

    expect(component.find('[data-testid="usage-daily-empty"]').exists()).toBe(true)
  })

  it('shows a usage-missing notice when some generations lack usage data', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: { summary: baseSummary },
    })

    expect(component.text()).toContain('Some usage data is missing')
  })

  it('renders an empty state when no groups are present', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: {
        summary: {
          ranges: baseSummary.ranges,
          daily: [],
          groups: [],
          total: { generations: 0, tokens: 0, costUsd: '0.000000', usageMissingGenerations: 0 },
        },
      },
    })

    expect(component.text()).toContain('No LLM usage')
    expect(component.find('table').exists()).toBe(false)
  })

  it('renders an error message when loading fails', async () => {
    const component = await mountSuspended(UsageSummary, {
      props: { summary: null, error: true },
    })

    expect(component.text()).toContain('Could not load')
  })
})
