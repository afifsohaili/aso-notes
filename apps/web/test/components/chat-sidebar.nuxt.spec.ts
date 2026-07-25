import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ChatSidebar from '../../app/components/chat/chat-sidebar.vue'

describe('chat-sidebar', () => {
  it('renders conversations, emits selection, and emits new conversation', async () => {
    const component = await mountSuspended(ChatSidebar, {
      props: {
        conversations: [
          { id: 'c1', title: 'First query', updatedAt: new Date().toISOString() },
          { id: 'c2', title: 'Second query', updatedAt: new Date().toISOString() },
        ],
        selectedId: null,
      },
    })

    expect(component.text()).toContain('First query')
    expect(component.text()).toContain('Second query')

    const items = component.findAll('li')
    expect(items).toHaveLength(2)

    await items[1]!.trigger('click')
    expect(component.emitted('select')).toHaveLength(1)
    expect(component.emitted('select')![0]).toEqual(['c2'])

    const newButton = component.find('button')
    await newButton.trigger('click')
    expect(component.emitted('newConversation')).toHaveLength(1)
  })
})
