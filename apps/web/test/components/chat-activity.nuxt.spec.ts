import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ChatActivity from '../../app/components/chat/chat-activity.vue'

describe('chat-activity', () => {
  const baseActivity = {
    toolCallId: 'call-1',
    name: 'search_notes',
    args: { query: 'graph rag' },
    status: 'done' as const,
    result: { notes: [{ path: '/a.md' }], count: 1 },
  }

  it('renders a compact row with name, args summary, and result summary', async () => {
    const component = await mountSuspended(ChatActivity, {
      props: { activities: [baseActivity] },
    })

    expect(component.text()).toContain('search_notes')
    expect(component.text()).toContain('graph rag')
    expect(component.text()).toContain('1 notes')
    // raw JSON stays hidden until expanded
    expect(component.text()).not.toContain('"query"')
  })

  it('expands to show raw input and output', async () => {
    const component = await mountSuspended(ChatActivity, {
      props: { activities: [baseActivity] },
    })

    const row = component.findAll('button').find(b => b.text().includes('search_notes'))
    await row!.trigger('click')

    expect(component.text()).toContain('"query"')
    expect(component.text()).toContain('"notes"')
  })

  it('shows pending state for activities without a result', async () => {
    const component = await mountSuspended(ChatActivity, {
      props: {
        activities: [{ ...baseActivity, status: 'pending' as const, result: undefined }],
      },
    })

    expect(component.text()).toContain('running')
  })
})
