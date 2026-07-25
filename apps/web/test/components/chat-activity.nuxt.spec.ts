import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ChatActivity from '../../app/components/chat/chat-activity.vue'

describe('chat-activity', () => {
  it('renders tool names and arguments, and expands to show results', async () => {
    const component = await mountSuspended(ChatActivity, {
      props: {
        activities: [
          {
            toolCallId: 'call-1',
            name: 'search_notes',
            args: { query: 'graph rag' },
            result: { count: 3 },
          },
        ],
      },
    })

    expect(component.text()).toContain('search_notes')
    expect(component.text()).toContain('graph rag')
    expect(component.text()).not.toContain('"count"')

    const toggle = component.find('button')
    await toggle.trigger('click')

    expect(component.text()).toContain('"count"')
    expect(component.text()).toContain('3')
  })
})
