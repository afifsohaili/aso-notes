import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ChatThread from '../../app/components/chat/chat-thread.vue'

describe('chat-thread', () => {
  it('renders user queries and assistant markdown answers', async () => {
    const component = await mountSuspended(ChatThread, {
      props: {
        messages: [
          { id: 'm1', role: 'user', content: 'What is Graph RAG?' },
          { id: 'm2', role: 'assistant', content: '# Graph RAG\n\nIt combines **graphs** and retrieval.' },
        ],
      },
    })

    expect(component.text()).toContain('What is Graph RAG?')
    expect(component.html()).toContain('<h1') // markdown rendered
    expect(component.html()).toContain('<strong>graphs</strong>')
  })

  it('renders cited notes as links to the notes page', async () => {
    const component = await mountSuspended(ChatThread, {
      props: {
        messages: [
          { id: 'm3', role: 'assistant', content: 'See this note.', notes: ['/project-a/plan.md'] },
        ],
      },
    })

    const link = component.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/notes?note=%2Fproject-a%2Fplan.md')
    expect(link.text()).toContain('/project-a/plan.md')
  })
})
