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
    expect(link.attributes('href')).toBe('/notes/project-a/plan.md')
    expect(link.text()).toContain('/project-a/plan.md')
  })

  it('emits edit for persisted user messages only', async () => {
    const component = await mountSuspended(ChatThread, {
      props: {
        messages: [
          { id: 'db-1', role: 'user', content: 'persisted message', persisted: true },
          { id: 'local-1', role: 'user', content: 'streamed message' },
        ],
      },
    })

    const editButtons = component.findAll('button[title]')
    expect(editButtons).toHaveLength(1)

    await editButtons[0]!.trigger('click')
    expect(component.emitted('edit')).toHaveLength(1)
    expect(component.emitted('edit')![0]![0]).toMatchObject({ id: 'db-1' })
  })

  it('shows a trace link for assistant answers with a traceId and conversationId', async () => {
    const component = await mountSuspended(ChatThread, {
      props: {
        conversationId: 'conv-1',
        messages: [
          { id: 'm4', role: 'assistant', content: 'Answer with trace.', traceId: 'trace-1' },
          { id: 'm5', role: 'assistant', content: 'Answer without trace.' },
        ],
      },
    })

    const links = component.findAll('a')
    const traceLink = links.find(a => a.attributes('href') === '/chat/conv-1/trace/trace-1')
    expect(traceLink).toBeDefined()
    expect(traceLink!.text()).toContain('View trace')

    const withoutTraceLink = links.find(a => a.attributes('href') === '/chat/conv-1/trace/')
    expect(withoutTraceLink).toBeUndefined()
  })
})
