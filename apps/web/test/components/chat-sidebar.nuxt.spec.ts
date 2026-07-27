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

  it('emits archive from the hover action and unarchive from the archived section', async () => {
    const component = await mountSuspended(ChatSidebar, {
      props: {
        conversations: [
          { id: 'c1', title: 'Active one', updatedAt: new Date().toISOString() },
        ],
        archivedConversations: [
          { id: 'c9', title: 'Old one', updatedAt: new Date().toISOString() },
        ],
        selectedId: null,
      },
    })

    // archived section is collapsed by default, shows count
    expect(component.text()).toContain('Archived (1)')

    const archiveBtn = component.find('button[title="Archive"]')
    await archiveBtn.trigger('click')
    expect(component.emitted('archive')).toHaveLength(1)
    expect(component.emitted('archive')![0]).toEqual(['c1'])

    // open the archived section, restore
    const sectionToggle = component.findAll('button').find(b => b.text().includes('Archived'))
    await sectionToggle!.trigger('click')
    const unarchiveBtn = component.find('button[title="Restore"]')
    await unarchiveBtn.trigger('click')
    expect(component.emitted('unarchive')).toHaveLength(1)
    expect(component.emitted('unarchive')![0]).toEqual(['c9'])
  })
})
